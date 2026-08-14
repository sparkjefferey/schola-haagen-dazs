"use client";

import { useEffect, useRef } from "react";
import { incrementViewsAction } from "@/lib/actions";

export default function ViewTally({ paperId }: { paperId: number }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    incrementViewsAction(paperId);
  }, [paperId]);
  return null;
}
