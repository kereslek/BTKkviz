// src/app/api/fix-unknown-names/route.ts
import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Select only rows with photo AND crime present, and bad name
    const { data: rows, error } = await supabase
      .from('criminals_cache')
      .select('id, police_id, name, crime, photo_url')
      .not('photo_url', 'is', null)               // must have image
      .not('crime', 'is', null)                   // must have crime
      .neq('crime', '')                           // crime not empty
      .or(
        `name.eq.Ismeretlen,` +
        `name.eq.Személyes adatok,` +
        `name.eq.ELFOGATÓPARANCS ALAPJÁN KÖRÖZÖTT SZEMÉLY,` +
        `name.ilike.%BTK%,` +
        `name.ilike.%§%,` +
        `name.ilike.%bekezdés%`
      )
      .order('fetched_at', { ascending: false });

    if (error) throw error;
    if (!rows?.length) {
      return NextResponse.json({ success: true, message: 'No qualifying bad names to fix.' });
    }

    console.log(`[fix-unknown] Found ${rows.length} rows with photo + crime + bad name`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    let fixedCount = 0;
    for (const row of rows) {
      const detailUrl = `https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/${row.police_id}`;
      try {
        await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(1000);

        const name = await page.evaluate(() => {
          // Priority: h1.page-title (actual name)
          const h1 = document.querySelector('h1.page-title');
          if (h1) {
            let text = h1.innerText.trim().toUpperCase();
            if (text && text.length > 5 && !text.includes('ELFOGATÓPARANCS') && !text.includes('SZEMÉLY') && !text.includes('KÖRÖZÖTT')) {
              return text;
            }
          }

          // Fallback: Név: field
          const content = document.querySelector('.content')?.innerText || '';
          const nameMatch = content.match(/Név:\s*([\w\s]+?)(?=\s*Született|Nem|Állampolgárság|Magasság|Testalkat|Szemszín|Hajszín|Jellegzetesség)/i);
          if (nameMatch) {
            let name = nameMatch[1].trim().toUpperCase();
            if (name && !name.includes('BTK') && !name.includes('§') && name.length > 5) return name;
          }

          // Last fallback: dt/dd pair for Név:
          const personal = document.querySelector('#personal-data');
          if (personal) {
            const labels = Array.from(personal.querySelectorAll('dt'));
            const nameIndex = labels.findIndex(dt => dt.innerText.trim() === 'Név:');
            if (nameIndex > -1) {
              const nameEl = personal.querySelectorAll('dd')[nameIndex];
              return nameEl?.innerText.trim().toUpperCase() || null;
            }
          }

          return null;
        });

        if (name && name !== row.name && name !== 'Ismeretlen') {
          const { error } = await supabase
            .from('criminals_cache')
            .update({ name })
            .eq('id', row.id);

          if (!error) {
            console.log(`[fix-unknown] Fixed ${row.police_id}: "${row.name}" → "${name}"`);
            fixedCount++;
          } else {
            console.error(`[fix-unknown] Supabase update failed for ${row.police_id}:`, error);
          }
        } else {
          console.log(`[fix-unknown] No better name found for ${row.police_id} (kept "${row.name}")`);
        }
      } catch (e) {
        console.error(`[fix-unknown] Failed to process ${row.police_id}:`, e);
      }

      await sleep(800); // polite delay
    }

    await browser.close();

    return NextResponse.json({
      success: true,
      fixed: fixedCount,
      totalProcessed: rows.length,
    });
  } catch (error) {
    console.error('[fix-unknown] Global error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const dynamic = 'force-dynamic';