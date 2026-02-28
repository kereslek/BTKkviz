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

const BASE_LIST_URL =
  'https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek';

export async function GET(_request: Request) {
  let browser: puppeteer.Browser | undefined;

  try {
    console.log('[scrape] Launching Puppeteer...');

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      timeout: 120000,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 2200 });

    // ---- 1) First try: base page ----
    const firstUrl = `${BASE_LIST_URL}?limit=500`;
    console.log('[scrape] Navigating to:', firstUrl);
    const firstBatch = await scrapeOneListPage(page, firstUrl);

    console.log(
      `[scrape] First page extracted raw=${firstBatch.rawCount} unique=${firstBatch.unique.length}`
    );

    // If we got only ~18, it’s probably paginated (not infinite scroll).
    // We'll crawl additional pages using a couple of common paging patterns.
    let allUnique = new Map<number, CriminalRow>();
    for (const row of firstBatch.unique) allUnique.set(row.police_id, row);

    // ---- 2) Paging fallback if suspiciously low ----
    if (firstBatch.unique.length <= 25) {
      console.log('[scrape] Low count detected -> trying paging crawl...');

      // Try multiple paging patterns, stop when no new IDs appear for a while.
      // We try:
      //  - ?page=N
      //  - ?limit=500&page=N
      //  - ?offset=N
      //  - ?limit=500&offset=N
      const maxPages = 60;         // hard cap
      const offsetStep = 18;       // matches your observed page size; adjust if needed
      let noNewStreak = 0;

      for (let i = 1; i <= maxPages; i++) {
        const candidateUrls = [
          `${BASE_LIST_URL}?page=${i}`,
          `${BASE_LIST_URL}?limit=500&page=${i}`,
          `${BASE_LIST_URL}?offset=${i * offsetStep}`,
          `${BASE_LIST_URL}?limit=500&offset=${i * offsetStep}`,
        ];

        let anyNewThisRound = false;

        for (const u of candidateUrls) {
          const batch = await scrapeOneListPage(page, u);
          let newCount = 0;

          for (const row of batch.unique) {
            if (!allUnique.has(row.police_id)) {
              allUnique.set(row.police_id, row);
              newCount++;
            } else {
              // update latest fetched_at + any improved fields
              const prev = allUnique.get(row.police_id)!;
              const prevScore = (prev.photo_url ? 10 : 0) + (prev.crime?.length || 0);
              const rowScore = (row.photo_url ? 10 : 0) + (row.crime?.length || 0);
              allUnique.set(row.police_id, rowScore > prevScore ? row : prev);
            }
          }

          if (newCount > 0) {
            anyNewThisRound = true;
            console.log(`[scrape] +${newCount} new from: ${u}`);
          }
        }

        // Also: if there’s a visible "next" link, follow it once per round (best-effort)
        const nextHref = await getNextPageHref(page);
        if (nextHref) {
          const absolute = nextHref.startsWith('http')
            ? nextHref
            : `https://www.police.hu${nextHref}`;
          const batch = await scrapeOneListPage(page, absolute);
          let newCount = 0;

          for (const row of batch.unique) {
            if (!allUnique.has(row.police_id)) {
              allUnique.set(row.police_id, row);
              newCount++;
            }
          }

          if (newCount > 0) {
            anyNewThisRound = true;
            console.log(`[scrape] +${newCount} new via NEXT link: ${absolute}`);
          }
        }

        if (!anyNewThisRound) noNewStreak++;
        else noNewStreak = 0;

        console.log(
          `[scrape] Paging round ${i}/${maxPages}: total unique so far = ${allUnique.size}, noNewStreak=${noNewStreak}`
        );

        // If several rounds produce nothing new, we’re likely done / pattern wrong.
        if (noNewStreak >= 5) break;
      }
    }

    const nowIso = new Date().toISOString();

    // finalize rows (refresh fetched_at to now for all)
    const finalRows = Array.from(allUnique.values()).map((r) => ({
      ...r,
      fetched_at: nowIso,
    }));

    console.log(`[scrape] Final unique rows to upsert: ${finalRows.length}`);

    if (!finalRows.length) {
      return NextResponse.json(
        { success: false, message: 'No rows found after paging attempts.' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('criminals_cache')
      .upsert(finalRows, { onConflict: 'police_id', ignoreDuplicates: false });

    if (error) throw new Error(`Supabase failed: ${error.message}`);

    return NextResponse.json({
      success: true,
      count: finalRows.length,
      message: 'Scraping successful! Rows upserted by police_id.',
      timestamp: nowIso,
      debug: {
        firstPageUnique: firstBatch.unique.length,
        finalUnique: finalRows.length,
      },
    });
  } catch (error) {
    console.error('[scrape] Scrape error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Scraping failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
      console.log('[scrape] Puppeteer closed');
    }
  }
}

/**
 * Scrape a single list page URL:
 * - open url
 * - try scroll a bit (in case lazy)
 * - extract rows
 * - dedupe internally by police_id
 */
async function scrapeOneListPage(page: puppeteer.Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('body', { timeout: 30000 });
  await sleep(900);

  // scroll a bit to trigger any lazy content (safe even if paginated)
  await autoScroll(page, 6);
  await sleep(700);

  // extract
  const scraped = await page.evaluate(() => {
    const ABS = 'https://www.police.hu';
    const normalize = (s: string) =>
      (s || '').trim().replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ');

    const getBestImgUrl = (img: HTMLImageElement | null) => {
      if (!img) return '';
      const cand =
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        '';
      if (!cand) return '';
      return cand.startsWith('http') ? cand : ABS + cand;
    };

    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/"]'
      )
    );

    const results: any[] = [];

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!href.includes('/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/')) continue;

      const idMatch = href.match(/\/(\d+)(?:\?|$)/);
      const policeId = idMatch ? parseInt(idMatch[1], 10) : null;
      if (!policeId) continue;

      const nameEl = a.querySelector<HTMLElement>('.name, div.name, h3, h2, strong, .caption');
      let name = normalize(nameEl?.innerText || a.innerText || '');
      if (!name) continue;

      const crimeEl = a.querySelector<HTMLElement>('.jogalap, .info, .caption, p');
      let crime = normalize(crimeEl?.innerText || 'N/A');

      const img = a.querySelector<HTMLImageElement>('img');
      const photoUrl = getBestImgUrl(img) || null;

      results.push({ police_id: policeId, name, crime, photo_url: photoUrl });
    }

    return { rawCount: results.length, results };
  });

  const nowIso = new Date().toISOString();

  // dedupe within this page
  const map = new Map<number, CriminalRow>();
  for (const r of scraped.results as any[]) {
    const police_id = Number(r.police_id);
    if (!Number.isFinite(police_id)) continue;

    const row: CriminalRow = {
      police_id,
      name: String(r.name ?? '').trim(),
      crime: String(r.crime ?? 'N/A').trim(),
      photo_url: r.photo_url ? String(r.photo_url) : null,
      fetched_at: nowIso,
    };

    const prev = map.get(police_id);
    if (!prev) {
      map.set(police_id, row);
    } else {
      const prevScore = (prev.photo_url ? 10 : 0) + (prev.crime?.length || 0);
      const rowScore = (row.photo_url ? 10 : 0) + (row.crime?.length || 0);
      map.set(police_id, rowScore > prevScore ? row : prev);
    }
  }

  return { rawCount: scraped.rawCount as number, unique: Array.from(map.values()) };
}

/**
 * Light scroll helper
 */
async function autoScroll(page: puppeteer.Page, steps = 8) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.9)));
    await sleep(250);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(350);
}

/**
 * Best-effort: find a "next page" link on the current page (if classic pagination exists).
 */
async function getNextPageHref(page: puppeteer.Page): Promise<string | null> {
  try {
    const href = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
      const norm = (s: string) => (s || '').trim().toLowerCase();

      // common patterns: "következő", "next", ">"
      const isNextText = (t: string) => {
        const s = norm(t);
        return s === 'következő' || s.includes('következő') || s === 'next' || s.includes('next') || s === '>';
      };

      for (const a of candidates) {
        const text = a.innerText || '';
        if (!isNextText(text)) continue;
        const h = a.getAttribute('href');
        if (h) return h;
      }

      // sometimes pagination uses rel="next"
      const relNext = document.querySelector<HTMLAnchorElement>('a[rel="next"]');
      return relNext?.getAttribute('href') || null;
    });

    return href || null;
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;