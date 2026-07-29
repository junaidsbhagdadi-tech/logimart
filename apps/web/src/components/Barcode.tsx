import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/** Renders a Code128 barcode (matches the childId encoded on thermal labels). */
export function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 12,
        height: 50,
        margin: 0,
      });
    }
  }, [value]);
  return <svg ref={ref} />;
}
