'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

type Props = {
  onChallengeParam: (challengeId: string | null) => void;
};

export default function SearchParamsHandler({ onChallengeParam }: Props) {
  const searchParams = useSearchParams();
  const c = searchParams?.get('c') ?? null;

  useEffect(() => {
    onChallengeParam(c);
  }, [c, onChallengeParam]);

  return null;
}