import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const policeId = searchParams.get('policeId');

  if (!policeId) {
    return NextResponse.json({ error: 'Missing policeId parameter' }, { status: 400 });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const url = `https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/${policeId}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extract name from h1.page-title - FIXED VERSION with type assertion
    const name = await page.evaluate(() => {
      const h1 = document.querySelector('h1.page-title') as HTMLElement | null;
      if (h1) {
        let text = h1.innerText.trim().toUpperCase();
        if (
          text &&
          text.length > 5 &&
          !text.includes('ELFOGATÓPARANCS') &&
          !text.includes('SZEMÉLY') &&
          !text.includes('KÖRÖZÖTT')
        ) {
          return text;
        }
      }
      return null;
    });

    // If name not found or invalid, try alternative selectors
    let finalName = name;
    if (!finalName) {
      finalName = await page.evaluate(() => {
        // Try other possible headings or strong elements
        const alternatives = [
          document.querySelector('h1'),
          document.querySelector('.person-name'),
          document.querySelector('strong'),
          document.querySelector('h2'),
        ];

        for (const el of alternatives) {
          if (el instanceof HTMLElement) {
            const text = el.innerText.trim().toUpperCase();
            if (text && text.length > 5 && !text.includes('ELFOGATÓPARANCS')) {
              return text;
            }
          }
        }
        return null;
      });
    }

    // Extract other fields (crime, photo, etc.) - keep your existing logic
    const data = await page.evaluate(() => {
      const crimeEl = document.querySelector('.crime-description, .description, p strong');
      const photoEl = document.querySelector('img[src*="korozott"], img.photo, .person-photo img');

      return {
        name: finalName || 'Ismeretlen',
        crime: crimeEl?.textContent?.trim() || 'Nem található bűncselekmény leírás',
        photoUrl: photoEl?.getAttribute('src') || null,
      };
    });

    await browser.close();

    return NextResponse.json({
      success: true,
      policeId,
      name: data.name,
      crime: data.crime,
      photoUrl: data.photoUrl ? new URL(data.photoUrl, 'https://www.police.hu').href : null,
    });
  } catch (error) {
    console.error('Name fixer error:', error);
    if (browser) await browser.close();
    return NextResponse.json(
      { error: 'Failed to fix name', details: (error as Error).message },
      { status: 500 }
    );
  }
}