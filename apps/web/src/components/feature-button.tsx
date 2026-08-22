import { Button, Tooltip } from "@pdf-studio/ui";
import type { ComponentProps } from "react";

export function FeatureButton({
  available,
  unavailableReason,
  ...props
}: ComponentProps<typeof Button> & { available: boolean; unavailableReason: string }) {
  if (available) return <Button {...props} />;
  return (
    <Tooltip content={unavailableReason}>
      <span className="inline-flex" tabIndex={0} aria-label={unavailableReason}>
        <Button {...props} disabled />
      </span>
    </Tooltip>
  );
}
