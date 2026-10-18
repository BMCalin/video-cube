import { Button } from '@/components/ui/button';
import type { Vec3 } from '@/render/linalg';
import { tiltDegrees } from '@/export/timeSlice';
import type { SliceKeyframe } from '@/export/timeSlice';
import { NumberSlider } from './fields';

/**
 * Editor for one end of the time-slice animation. Times are stored as
 * fractions of the clip and shown in seconds once the source is known.
 */
export function KeyframeEditor(props: {
  id: string;
  title: string;
  value: SliceKeyframe;
  /** Clip length in seconds, or null to show percentages (demo volume). */
  clipSeconds: number | null;
  half: Vec3;
  onChange: (kf: SliceKeyframe) => void;
  onCapture: () => void;
  onShow: () => void;
}) {
  const { value: kf, clipSeconds } = props;
  const scale = clipSeconds ?? 100;
  const unit = clipSeconds ? 's' : '%';
  const decimals = clipSeconds ? 2 : 1;
  const tilt = tiltDegrees({ ...kf, span: Math.abs(kf.span) }, props.half);
  const set = (patch: Partial<SliceKeyframe>) => props.onChange({ ...kf, ...patch });

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{props.title}</span>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={props.onCapture}
            title="Copy the slice plane currently set in the 3D view"
          >
            From 3D plane
          </Button>
          <Button size="xs" variant="ghost" onClick={props.onShow} title="Move the 3D slice plane here">
            Show
          </Button>
        </div>
      </div>
      <NumberSlider
        id={`${props.id}-time`}
        label="Time at pivot"
        unit={unit}
        min={0}
        max={1}
        step={0.001}
        value={kf.time}
        scale={scale}
        decimals={decimals}
        onValueChange={(time) => set({ time })}
      />
      <NumberSlider
        id={`${props.id}-span`}
        label="Time span across frame"
        hint={`~${tilt.toFixed(1)}\u00b0 tilt in 3D view`}
        unit={unit}
        min={-0.5}
        max={0.5}
        step={0.001}
        inputMin={-1}
        inputMax={1}
        value={kf.span}
        scale={scale}
        decimals={decimals}
        onValueChange={(span) => set({ span })}
      />
      <NumberSlider
        id={`${props.id}-azimuth`}
        label="Gradient direction"
        unit={'\u00b0'}
        min={-180}
        max={180}
        step={1}
        value={kf.azimuth}
        decimals={0}
        onValueChange={(azimuth) => set({ azimuth })}
      />
    </div>
  );
}
