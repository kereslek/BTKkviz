import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  let browser;
  try {
    console.log('[scrape] Starting...');

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    const baseUrl = 'https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek';
    let pageNum = 1;
    const inserted = [];
    const errors = [];

    while (true) {
      console.log(`[scrape] Processing page ${pageNum}`);
      const url = pageNum === 1 ? baseUrl : `${baseUrl}?page=${pageNum}`;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

      // Wait for list items to appear
      await page.waitForSelector('.view-content .views-row', { timeout: 20000 }).catch(() => {});

      const persons = await page.evaluate(() => {
        const rows = document.querySelectorAll('.view-content .views-row');
        return Array.from(rows).map(row => {
          const link = row.querySelector('a[href*="/elfogatoparancs-alapjan-korozott-szemelyek/"]');
          const id = link ? link.getAttribute('href')?.split('/').pop() : null;
          const nameEl = row.querySelector('.views-field-title a');
          const name = nameEl ? nameEl.textContent?.trim() : null;
          const photo = row.querySelector('img')?.getAttribute('src') || null;

          return { police_id: id, name, photo_url: photo };
        }).filter(p => p.police_id);
      });

      if (persons.length === 0) {
        console.log('[scrape] No more persons → stopping');
        break;
      }

      console.log(`[scrape] Found ${persons.length} persons on page ${pageNum}`);

      for (const person of persons) {
        if (!person.police_id) continue;

        try {
          const { error } = await supabase
            .from('criminals_cache')
            .upsert(
              {
                police_id: person.police_id,
                name: person.name || 'Ismeretlen',
                photo_url: person.photo_url ? `https://www.police.hu${person.photo_url}` : null,
                fetched_at: new Date().toISOString(),
              },
              { onConflict: 'police_id' }
            );

          if (error) throw error;

          inserted.push(person.police_id);
        } catch (err) {
          errors.push({ id: person.police_id, error: (err as Error).message });
        }
      }

            pageNum++;
      await new Promise(resolve => setTimeout(resolve, 3000)); // polite delay between pages
    }

    await browser.close();

    return NextResponse.json({
      success: true,
      inserted: inserted.length,
      errors: errors.length ? errors : undefined,
      message: errors.length 
        ? `${inserted.length} inserted, ${errors.length} failed` 
        : `${inserted.length} persons processed`,
    });

    
  } catch (error) {
    console.error('[scrape] Fatal error:', error);
    if (browser) await browser.close();
    return NextResponse.json(
      { error: 'Scrape failed', details: (error as Error).message },
      { status: 500 }
    );
  }
}