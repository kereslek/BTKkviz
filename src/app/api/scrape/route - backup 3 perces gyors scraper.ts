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
    const all = new Map<number, CriminalRow>();
    const maxPagesHardCap = 2; // For testing, ~3min run

    let noNewStreak = 0;
    for (let p = 0; p <= maxPagesHardCap; p++) {
      const url = p === 0 ? `${BASE_LIST_URL}?limit=20` : `${BASE_LIST_URL}?page=${p}&limit=20`;
      let batch = await scrapeOneListPage(page, url, runTs);

      // Detail for photos if missing or bad
      for (let i = 0; i < batch.length; i++) {
        if (!batch[i].photo_url || batch[i].photo_url.includes('logo') || batch[i].photo_url.includes('szolgalunk')) {
          const detailUrl = `${BASE_DETAIL_URL}${batch[i].police_id}`;
          const betterPhoto = await scrapeDetailPhoto(page, detailUrl, batch[i].name);
          if (betterPhoto) batch[i].photo_url = betterPhoto;
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
      if (noNewStreak >= 2) break;
      await sleep(1500 + Math.random() * 1500); // 1500-3000ms
    }
    const finalRows = Array.from(all.values());
    console.log(`[scrape] Final unique rows to upsert: ${finalRows.length}`);
    if (!finalRows.length) {
      return NextResponse.json({ success: false, message: 'No rows scraped.' }, { status: 404 });
    }
    // Upsert in chunks
    const chunkSize = 500;
    for (let i = 0; i < finalRows.length; i += chunkSize) {
      const chunk = finalRows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('criminals_cache')
        .upsert(chunk, { onConflict: 'police_id' });
      if (error) throw new Error(`Supabase failed: ${error.message}`);
      console.log(`[scrape] Inserted chunk ${i}-${i + chunk.length - 1}`);
    }
    return NextResponse.json({
      success: true,
      count: finalRows.length,
      message: 'Scraping successful! Rows inserted.',
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
  await page.waitForSelector('body', { timeout: 30000 });
  await sleep(5000);
  // Multi scroll
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1500);
  }
  // Force lazy
  await page.evaluate(() => {
    document.querySelectorAll('img[data-src], img[data-lazy-src], img.lazy').forEach(img => {
      const src = (img as any).dataset.src || (img as any).dataset.lazySrc || '';
      if (src) (img as any).src = src;
      img.removeAttribute('data-src');
      img.removeAttribute('data-lazy-src');
    });
  });
  await sleep(2000);
  // Wait for imgs
  try {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('img.lazy')).every(img => img.src && !img.src.includes('placeholder')), { timeout: 20000 });
  } catch {}
  const scraped = await page.evaluate(() => {
    const ABS = 'https://www.police.hu';
    const normalize = (s: string) => (s || '').trim().replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ');
    const absolutize = (url: string) => {
      if (!url) return '';
      if (url.startsWith('http')) return url;
      if (url.startsWith('//')) return 'https:' + url;
      return ABS + url;
    };
    const pickFirstText = (root: Element, selectors: string[]) => {
      for (const sel of selectors) {
        const el = root.querySelector<HTMLElement>(sel);
        const t = normalize(el?.innerText || '');
        if (t) return t;
      }
      return '';
    };
    const getName = (a: HTMLAnchorElement) => {
      const selectors = ['.name', 'div.name', '.caption', 'h3', 'h2', 'strong'];
      let name = pickFirstText(a, selectors);
      if (name) return normalize(name);
      const img = a.querySelector<HTMLImageElement>('img');
      const alt = normalize(img?.getAttribute('alt') || '');
      if (alt) return alt;
      return normalize(a.innerText || '');
    };
    const getCrime = (a: HTMLAnchorElement) => {
      const selectors = ['.jogalap', '.caption', 'p', '.info'];
      let crime = pickFirstText(a, selectors);
      if (!crime) crime = 'N/A';
      return normalize(crime);
    };
    const getPhoto = (a: HTMLAnchorElement) => {
      const img = a.querySelector<HTMLImageElement>('img');
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src && !src.includes('placeholder')) return absolutize(src);
      }
      return null;
    };
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/"]')
    );
    const results: any[] = [];
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\/(\d+)(?:\?|$)/);
      const policeId = idMatch ? parseInt(idMatch[1], 10) : null;
      if (!policeId) continue;
      const name = getName(a);
      if (!name) continue;
      const crime = getCrime(a);
      const photo = getPhoto(a);
      results.push({ police_id: policeId, name, crime, photo_url: photo });
    }
    return results;
  });
  const map = new Map<number, CriminalRow>();
  for (const r of scraped as any[]) {
    const police_id = Number(r.police_id);
    if (!Number.isFinite(police_id)) continue;
    const row: CriminalRow = {
      police_id,
      name: String(r.name ?? '').trim(),
      crime: String(r.crime ?? 'N/A').trim(),
      photo_url: r.photo_url ? String(r.photo_url) : null,
      fetched_at: runTs,
    };
    map.set(police_id, row);
  }
  return Array.from(map.values());
}
async function scrapeDetailPhoto(page: puppeteer.Page, url: string): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000);
    const photo = await page.evaluate(() => {
      const ABS = 'https://www.police.hu';
      const img = document.querySelector<HTMLImageElement>('.field--name-field-korozott-foto img, img[src*="koral_public"], img[src*="files/"]');
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src && !src.includes('placeholder') && !src.includes('logo')) {
          return ABS + src;
        }
      }
      return null;
    });
    return photo;
  } catch (e) {
    console.error('[detail] Detail error for ${url}:', e);
    return null;
  }
}
export const dynamic = 'force-dynamic';
export const revalidate = 0;