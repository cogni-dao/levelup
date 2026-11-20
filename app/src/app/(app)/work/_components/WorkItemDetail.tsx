// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import type { ReactElement } from "react";

import { Sheet, SheetContent } from "@/components";

import type { WorkItemDetailBodyProps } from "./WorkItemDetailBody";
import { WorkItemDetailBody } from "./WorkItemDetailBody";

/** The item sheet: the shared view (story.0085) in a controlled Sheet, used by /work and the dashboard. */
export function WorkItemDetail({
  open,
  onOpenChange,
  ...body
}: WorkItemDetailBodyProps & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <WorkItemDetailBody {...body} />
      </SheetContent>
    </Sheet>
  );
}
