import type { ReactNode } from "react";

export function PageHeading({
  eyebrow,
  title,
  description,
  align = "left",
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  aside?: ReactNode;
}) {
  const content = (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display-title mt-3 text-5xl text-ink sm:text-6xl">{title}</h1>
      {description ? <p className={`mt-5 text-base leading-7 text-muted ${align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>{description}</p> : null}
    </div>
  );

  if (!aside) return <header>{content}</header>;
  return <header className="flex flex-wrap items-end justify-between gap-6">{content}{aside}</header>;
}
