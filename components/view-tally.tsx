"use client";

import { useEffect, useRef } from "react";
import { incrementViewsAction } from "@/lib/actions";

export default function ViewTally({ paperId, authorId }: { paperId: number; authorId: number }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    incrementViewsAction(paperId, authorId);
  }, [paperId, authorId]);
  return null;
}