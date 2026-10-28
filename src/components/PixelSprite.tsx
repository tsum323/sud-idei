import { memo } from "react";
import { PALETTE } from "./sprites";

interface Props {
  rows: string[];
  /** Размер одного «пикселя» в CSS-пикселях. */
  scale?: number;
  className?: string;
  title?: string;
}

/** Рисует спрайт как SVG: соседние пиксели одного цвета объединяются в один прямоугольник. */
export const PixelSprite = memo(function PixelSprite({ rows, scale = 4, className, title }: Props) {
  const width = Math.max(...rows.map((r) => r.length));
  const rects: React.ReactElement[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let len = 1;
      while (x + len < row.length && row[x + len] === ch) len++;
      if (ch !== "." && PALETTE[ch]) {
        rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={len} height={1} fill={PALETTE[ch]} />);
      }
      x += len;
    }
  });
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${rows.length}`}
      width={width * scale}
      height={rows.length * scale}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {rects}
    </svg>
  );
});
