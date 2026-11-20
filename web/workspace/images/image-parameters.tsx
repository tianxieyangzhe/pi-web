import { settingsInput, settingsLabel, settingsSelect } from "../settings-page";
import type { ImageRecord as R } from "../../api/image-client";

export const emptyParameters = { schemaVersion: 1, explicitParameters: {} };
const iconSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const standardSpec = { schemaVersion: 1, format: "png", fit: "contain", background: "transparent", resample: "lanczos3" };
const presetSpec = { ...standardSpec, targets: iconSizes.map(size => ({ name: `logo-${size}.png`, width: size, height: size, sourceIndex: 0 })) };
const singleSpec = { ...standardSpec, targets: [{ name: "image.png", width: 1024, height: 1024, sourceIndex: 0 }] };
const operationLabels: Record<string, string> = { process: "精确处理", edit: "修改图片", generate: "生成图片" };
const parameterLabels: Record<string, string> = { n: "生成数量", size: "生成尺寸", quality: "生成质量", background: "生成背景" };

export function ImageParameters({ profile, capabilities, value, disabled, onChange }: {
  profile?: R; capabilities: R | null; value: R; disabled: boolean; onChange: (value: R) => void;
}) {
  const spec = value.outputSpec;
  const limits = capabilities?.outputLimits;
  const presetSelected = spec?.targets.length === iconSizes.length && spec.targets.every((target: R, index: number) => target.name === presetSpec.targets[index].name);
  const setOutput = (next: R | undefined) => {
    const { outputSpec: _, ...previous } = value;
    onChange(next ? { ...previous, outputSpec: next } : previous);
  };
  function setParameter(parameter: R, raw: string) {
    const parameters = { ...value.explicitParameters };
    if (!raw) delete parameters[parameter.key];
    else if (parameter.type === "integer" || parameter.type === "number") parameters[parameter.key] = Number(raw);
    else if (parameter.type === "boolean") parameters[parameter.key] = raw === "true";
    else parameters[parameter.key] = raw;
    onChange({ ...value, explicitParameters: parameters });
  }
  function setFormat(format: string) {
    const { quality, ...previous } = spec;
    setOutput({ ...previous, format, background: format === "jpeg" && spec.background === "transparent" ? "#FFFFFF" : spec.background,
      targets: spec.targets.map((target: R) => ({ ...target, name: target.name.replace(/\.[a-z]+$/i, `.${format}`) })),
      ...(format !== "png" && quality !== undefined ? { quality } : {}),
    });
  }
  return <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" disabled={disabled}>
    <legend className="mb-2 text-sm font-medium">参数／输出</legend>
    {(value.operation === "process" ? [] : profile?.parameters ?? []).map((parameter: R) => {
      const chosen = value.explicitParameters[parameter.key] ?? "";
      const options = parameter.enum ?? (parameter.type === "boolean" ? [true, false] : null);
      const placeholder = parameter.default === undefined ? "由模型决定" : `由模型决定（默认 ${parameter.default}）`;
      return <label className={settingsLabel} key={parameter.key}>
        {parameterLabels[parameter.key] ?? parameter.description}
        {options ? <select className={settingsSelect} value={String(chosen)} onChange={event => setParameter(parameter, event.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((option: string | number | boolean) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
        </select> : <input className={settingsInput} type={parameter.type === "integer" || parameter.type === "number" ? "number" : "text"}
          min={parameter.min} max={parameter.max} step={parameter.type === "integer" ? 1 : "any"} placeholder={placeholder}
          value={chosen} onChange={event => setParameter(parameter, event.target.value)} />}
      </label>;
    })}
    {capabilities?.operations && <label className={settingsLabel}>
      图片操作
      <select className={settingsSelect} value={value.operation ?? ""} onChange={event => {
        const { operation: _, ...previous } = value;
        const operation = event.target.value;
        onChange({ ...previous, ...(operation ? { operation } : {}), ...(operation === "process" ? { explicitParameters: {} } : {}) });
      }}>
        <option value="">由模型决定</option>
        {Object.keys(capabilities.operations).map(operation => <option key={operation} value={operation}>{operationLabels[operation]}</option>)}
      </select>
    </label>}
    {limits && <label className={settingsLabel}>
      导出规格
      <select className={settingsSelect} value={!spec ? "auto" : presetSelected ? "website-logo" : "custom"} onChange={event => {
        setOutput(event.target.value === "website-logo" ? presetSpec : event.target.value === "custom" ? singleSpec : undefined);
      }}>
        <option value="auto">由模型决定</option>
        <option value="custom">自定义单尺寸</option>
        {capabilities?.presets.some((preset: R) => preset.id === "website-logo") && <option value="website-logo">网站 Logo 九尺寸</option>}
      </select>
    </label>}
    {spec && limits && !presetSelected && <>
      <label className={settingsLabel}>导出格式
        <select className={settingsSelect} value={spec.format} onChange={event => setFormat(event.target.value)}>
          {limits.formats.map((format: string) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(["width", "height"] as const).map((dimension, index) => <label className={settingsLabel} key={dimension}>
          {index === 0 ? "宽度" : "高度"} (px)
          <input className={`${settingsInput} min-w-0 w-full`} type="number" min={1} max={limits.maxDimension} step={1}
            value={spec.targets[0][dimension] || ""} onChange={event => setOutput({ ...spec, targets: [{ ...spec.targets[0], [dimension]: Number(event.target.value) }] })} />
        </label>)}
      </div>
      <label className={settingsLabel}>尺寸适配
        <select className={settingsSelect} value={spec.fit} onChange={event => setOutput({ ...spec, fit: event.target.value })}>
          {limits.fits.map((fit: string) => <option key={fit} value={fit}>{fit === "contain" ? "保持比例并补边" : "保持比例并裁切"}</option>)}
        </select>
      </label>
      <label className={settingsLabel}>导出补边背景
        <select className={settingsSelect} value={spec.background === "transparent" ? "transparent" : "color"} onChange={event => setOutput({ ...spec, background: event.target.value === "transparent" ? "transparent" : "#FFFFFF" })}>
          {spec.format !== "jpeg" && <option value="transparent">透明</option>}<option value="color">纯色</option>
        </select>
        {spec.background !== "transparent" && <input aria-label="导出补边颜色" className={`${settingsInput} w-12!`} type="color" value={spec.background} onChange={event => setOutput({ ...spec, background: event.target.value.toUpperCase() })} />}
      </label>
      {spec.format !== "png" && <label className={settingsLabel}>导出质量
        <input className={settingsInput} type="number" min={1} max={100} placeholder="默认" value={spec.quality ?? ""}
          onChange={event => {
            const { quality: _, ...previous } = spec;
            setOutput(event.target.value ? { ...previous, quality: Number(event.target.value) } : previous);
          }} />
      </label>}
    </>}
  </fieldset>;
}
