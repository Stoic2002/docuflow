import type { RegisteredFont } from "@pdf-studio/api-client";
import { flipY, fontStack } from "./geometry";
import { type OverlayObject, boundsOf, isBox, isPath } from "./types";

/**
 * Objects are drawn in an SVG whose viewBox is the page box in points, so the
 * layer stays resolution independent and zoom is just a CSS width.
 */

// PDF rotation runs counter-clockwise; SVG's runs clockwise because Y is down.
function rotationTransform(object: OverlayObject, pageHeight: number): string | undefined {
  if (!object.rotation) return undefined;
  const bounds = boundsOf(object);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = flipY(bounds.y + bounds.height / 2, pageHeight);
  return `rotate(${-object.rotation} ${centerX} ${centerY})`;
}

function ObjectShape({ object, pageHeight, fonts }: { object: OverlayObject; pageHeight: number; fonts: RegisteredFont[] }) {
  const transform = rotationTransform(object, pageHeight);
  if (object.kind === "text") {
    const anchor = object.align === "center" ? "middle" : object.align === "right" ? "end" : "start";
    return (
      <text
        x={object.x}
        y={flipY(object.y, pageHeight)}
        fontSize={object.fontSize}
        fontFamily={fontStack(object.font, fonts)}
        fill={object.color}
        opacity={object.opacity}
        textAnchor={anchor}
        transform={transform}
        style={{ whiteSpace: "pre" }}
      >
        {object.text}
      </text>
    );
  }
  if (isBox(object)) {
    return object.kind === "rectangle" ? (
      <rect
        x={object.x}
        y={flipY(object.y + object.height, pageHeight)}
        width={object.width}
        height={object.height}
        fill={object.fill ?? "none"}
        stroke={object.strokeWidth > 0 ? object.stroke : "none"}
        strokeWidth={object.strokeWidth}
        opacity={object.opacity}
        transform={transform}
      />
    ) : (
      <ellipse
        cx={object.x + object.width / 2}
        cy={flipY(object.y + object.height / 2, pageHeight)}
        rx={Math.abs(object.width) / 2}
        ry={Math.abs(object.height) / 2}
        fill={object.fill ?? "none"}
        stroke={object.strokeWidth > 0 ? object.stroke : "none"}
        strokeWidth={object.strokeWidth}
        opacity={object.opacity}
        transform={transform}
      />
    );
  }
  if (isPath(object)) {
    return (
      <polyline
        points={object.points.map((point) => `${point.x},${flipY(point.y, pageHeight)}`).join(" ")}
        fill="none"
        stroke={object.stroke}
        strokeWidth={object.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={object.opacity}
        transform={transform}
      />
    );
  }
  return (
    <image
      href={object.previewUrl}
      x={object.centerX - object.width / 2}
      y={flipY(object.centerY + object.height / 2, pageHeight)}
      width={object.width}
      height={object.height}
      opacity={object.opacity}
      transform={transform}
      preserveAspectRatio="none"
    />
  );
}

function SelectionOutline({ object, pageHeight, scale }: { object: OverlayObject; pageHeight: number; scale: number }) {
  const bounds = boundsOf(object);
  const padding = 3 / scale;
  return (
    <rect
      x={bounds.x - padding}
      y={flipY(bounds.y + bounds.height, pageHeight) - padding}
      width={Math.max(bounds.width, 1) + padding * 2}
      height={Math.max(bounds.height, 1) + padding * 2}
      fill="none"
      stroke="#ff2d2d"
      strokeWidth={1.5 / scale}
      strokeDasharray={`${4 / scale} ${3 / scale}`}
      pointerEvents="none"
      transform={object.rotation ? rotationTransform(object, pageHeight) : undefined}
    />
  );
}

export function ObjectLayer({
  objects,
  pageWidth,
  pageHeight,
  selectedId,
  scale,
  fonts,
  draft,
}: {
  objects: OverlayObject[];
  pageWidth: number;
  pageHeight: number;
  selectedId: string | null;
  scale: number;
  fonts: RegisteredFont[];
  draft: OverlayObject | null;
}) {
  return (
    <svg
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      width={pageWidth * scale}
      height={pageHeight * scale}
      className="absolute left-0 top-0"
      aria-hidden="true"
    >
      {objects.map((object) => (
        <ObjectShape key={object.id} object={object} pageHeight={pageHeight} fonts={fonts} />
      ))}
      {draft ? <ObjectShape object={draft} pageHeight={pageHeight} fonts={fonts} /> : null}
      {objects
        .filter((object) => object.id === selectedId)
        .map((object) => (
          <SelectionOutline key={`outline-${object.id}`} object={object} pageHeight={pageHeight} scale={scale} />
        ))}
    </svg>
  );
}
