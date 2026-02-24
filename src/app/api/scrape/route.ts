// src/app/api/scrape/route.ts
import { NextResponse } from 'next/server';

/**
 * Minimal API route handler.
 * IMPORTANT:
 * - No "use client"
 * - No React / JSX
 * - No browser-only libs (confetti, supabase client SDK, etc.)
 */

export async function GET(_request: Request) {
  try {
    // TODO: implement real scraping logic here later (fetch police.hu, parse HTML, store to DB, etc.)
    return NextResponse.json(
      {
        success: true,
        message: 'Scraping endpoint is ready',
        timestamp: new Date().toISOString(),
        note: 'Implement real scraping logic here (police.hu list, etc.)',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Scrape error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Disable caching (so GET always runs fresh on Vercel/Next runtime)
export const dynamic = 'force-dynamic';
export const revalidate = 0;