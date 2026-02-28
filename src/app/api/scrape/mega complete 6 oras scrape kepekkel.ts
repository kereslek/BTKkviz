// src/app/api/scrape/route.ts
import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { supabase } from '@/lib/supabase';

type CriminalRow = {
  name: string;
  crime: string;
  photo_url: string | null;
  police_id: number;
  fetched_at: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE_LIST_URL = 'https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek';
const BASE_DETAIL_URL = 'https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/';

export async function GET(_request: Request) {
  let browser: puppeteer.Browser | undefined;
  try {
    console.log('[scrape] Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 120000,
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 2200 });

    const runTs = new Date().toISOString();

    // Get approximate current row count to dynamically limit pages
    const { count: existingCount } = await supabase
      .from('criminals_cache')
      .select('*', { count: 'exact', head: true });

    const maxPagesHardCap = Math.max(3, Math.floor((existingCount || 0) / 10));
    console.log(`[scrape] Existing rows: ${existingCount || 0} → max pages: ${maxPagesHardCap}`);

    const all = new Map<number, CriminalRow>();
    let noNewStreak = 0;

    for (let p = 0; p <= maxPagesHardCap; p++) {
      const url = p === 0 ? `${BASE_LIST_URL}?limit=20` : `${BASE_LIST_URL}?page=${p}&limit=20`;
      let batch = await scrapeOneListPage(page, url, runTs);

      // Try detail only if list photo is missing or suspicious
      for (let i = 0; i < batch.length; i++) {
        const current = batch[i].photo_url || '';
        if (
          !current ||
          current.includes('logo') ||
          current.includes('szolgalunk') ||
          current.includes('placeholder') ||
          current.includes('header') ||
          current.includes('footer')
        ) {
          const detailUrl = `${BASE_DETAIL_URL}${batch[i].police_id}`;
          const better = await scrapeDetailPhoto(page, detailUrl, batch[i].name);
          if (better) {
            console.log(`[detail] Better photo found for ${batch[i].police_id}: ${better}`);
            batch[i].photo_url = better;
          }
        }
      }

      let newCount = 0;
      for (const row of batch) {
        if (!all.has(row.police_id)) {
          all.set(row.police_id, row);
          newCount++;
        } else {
          const prev = all.get(row.police_id)!;
          const prevScore = (prev.photo_url ? 10 : 0) + (prev.crime?.length || 0);
          const rowScore = (row.photo_url ? 10 : 0) + (row.crime?.length || 0);
          all.set(row.police_id, rowScore > prevScore ? row : prev);
        }
      }

      console.log(`[scrape] page=${p} extracted=${batch.length} new=${newCount} totalUnique=${all.size}`);

      if (newCount === 0) noNewStreak++;
      else noNewStreak = 0;
      if (noNewStreak >= 3) {
        console.log(`[scrape] Stopping early: no new entries for 3 pages`);
        break;
      }

      await sleep(1800 + Math.random() * 2200); // 1.8–4s between pages
    }

    const finalRows = Array.from(all.values());
    console.log(`[scrape] Final unique rows to upsert: ${finalRows.length}`);

    if (!finalRows.length) {
      return NextResponse.json({ success: false, message: 'No rows scraped.' }, { status: 404 });
    }

    const chunkSize = 500;
    for (let i = 0; i < finalRows.length; i += chunkSize) {
      const chunk = finalRows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('criminals_cache')
        .upsert(chunk, { onConflict: 'police_id' });
      if (error) throw new Error(`Supabase failed: ${error.message}`);
      console.log(`[scrape] Upserted chunk ${i}-${i + chunk.length - 1}`);
    }

    return NextResponse.json({
      success: true,
      count: finalRows.length,
      message: 'Scraping successful! Rows upserted.',
      timestamp: runTs,
    });
  } catch (error) {
    console.error('[scrape] Scrape error:', error);
    return NextResponse.json({
      success: false,
      error: 'Scraping failed',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
      console.log('[scrape] Puppeteer closed');
    }
  }
}

async function scrapeOneListPage(page: puppeteer.Page, url: string, runTs: string) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  // Aggressive lazy load trigger
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1200);
  }

  // Force set src from data-src / lazy
  await page.evaluate(() => {
    document.querySelectorAll('img[data-src], img[data-lazy-src], img.lazy').forEach(img => {
      const src = (img as any).dataset.src || (img as any).dataset.lazySrc || '';
      if (src) (img as any).src = src;
    });
  });
  await sleep(2500);

  const scraped = await page.evaluate(() => {
    const ABS = 'https://www.police.hu';
    const normalize = (s: string) => (s || '').trim().replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ');
    const absolutize = (url: string) => {
      if (!url) return '';
      if (url.startsWith('http')) return url;
      if (url.startsWith('//')) return 'https:' + url;
      return ABS + url;
    };

    const getPhoto = (a: HTMLAnchorElement) => {
      const img = a.querySelector<HTMLImageElement>('img');
      if (img) {
        let src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        if (
          src &&
          !src.includes('placeholder') &&
          !src.includes('logo') &&
          !src.includes('szolgalunk') &&
          !src.includes('header') &&
          !src.includes('footer')
        ) {
          return absolutize(src);
        }
      }
      return null;
    };

    const results: any[] = [];
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/"]')
    );

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\/(\d+)(?:\?|$)/);
      const policeId = idMatch ? parseInt(idMatch[1], 10) : null;
      if (!policeId) continue;

      const nameEl = a.querySelector('.name, h3, strong, .caption');
      const name = nameEl ? nameEl.innerText.trim() : '';

      const crimeEl = a.querySelector('.jogalap, p, .info');
      const crime = crimeEl ? crimeEl.innerText.trim() : 'N/A';

      const photo = getPhoto(a);

      if (name) {
        results.push({ police_id: policeId, name, crime, photo_url: photo });
      }
    }
    return results;
  });

  const map = new Map<number, CriminalRow>();
  for (const r of scraped as any[]) {
    const police_id = Number(r.police_id);
    if (!Number.isFinite(police_id)) continue;
    map.set(police_id, {
      police_id,
      name: String(r.name ?? '').trim(),
      crime: String(r.crime ?? 'N/A').trim(),
      photo_url: r.photo_url ? String(r.photo_url) : null,
      fetched_at: runTs,
    });
  }
  return Array.from(map.values());
}

async function scrapeDetailPhoto(page: puppeteer.Page, url: string, nameHint: string = ''): Promise<string | null> {
  try {
    console.log(`[detail] Visiting ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    const photo = await page.evaluate((nameHint: string) => {
      const ABS = 'https://www.police.hu';

      // Priority selectors (most specific first)
      const prioritySelectors = [
        '.field--name-field-kep img',
        '.field--name-field-korozott-foto img',
        '.field--type-image img',
        'img[src*="koral_public"]',
        'img[src*="files/koral"]',
        '.korozott-foto img',
        '.person-foto img',
        '.main-content img:first-of-type'
      ];

      let img: HTMLImageElement | null = null;

      for (const sel of prioritySelectors) {
        img = document.querySelector<HTMLImageElement>(sel);
        if (img) break;
      }

      // Fallback: best looking portrait
      if (!img) {
        const allImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
        const candidates = allImgs.filter(el => {
          const src = el.src || el.dataset.src || el.getAttribute('data-lazy-src') || '';
          const alt = el.alt.toLowerCase();
          const w = el.naturalWidth || el.width || 0;
          const h = el.naturalHeight || el.height || 0;

          return (
            src &&
            src.includes('files/') &&
            !src.includes('logo') &&
            !src.includes('szolgalunk') &&
            !src.includes('placeholder') &&
            !src.includes('header') &&
            !src.includes('footer') &&
            w >= 180 &&
            h >= 220 &&
            h / w > 1.1 && // taller than wide → portrait
            (!alt || alt.includes('kép') || alt.includes('foto') || alt.includes('személy') || alt.toLowerCase().includes(nameHint.toLowerCase()))
          );
        });

        if (candidates.length > 0) {
          // Sort by size descending
          img = candidates.sort((a, b) => (b.naturalWidth || 0) - (a.naturalWidth || 0))[0];
        }
      }

      if (img) {
        let src = img.src || img.dataset.src || img.getAttribute('data-lazy-src') || '';
        if (src && !src.startsWith('http')) src = ABS + src;
        if (
          src &&
          !src.includes('logo') &&
          !src.includes('szolgalunk') &&
          !src.includes('placeholder') &&
          !src.includes('header') &&
          !src.includes('footer')
        ) {
          return src;
        }
      }

      return null;
    }, nameHint);

    if (photo) {
      console.log(`[detail] Found photo: ${photo}`);
    } else {
      console.log(`[detail] No valid photo found for ${url}`);
    }

    return photo;
  } catch (e) {
    console.error(`[scrape] Detail error for ${url}:`, e);
    return null;
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;