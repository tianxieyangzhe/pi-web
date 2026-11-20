import { useState } from "react";
import { Button } from "../../components/button";
import {
  settingsInput,
  settingsLabel,
  settingsSelect,
  settingsTextarea,
} from "../settings-page";
import type { ImageRecord as R } from "../../api/image-client";
export function ImagePlanEditor({
  initial,
  profiles,
  assets,
  busy,
  onSave,
  onClose,
}: {
  initial: R;
  profiles: R[];
  assets: R[];
  busy: boolean;
  onSave: (plan: R) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<R>(() => structuredClone(initial));
  const patch = (value: R) => setPlan((p) => ({ ...p, ...value }));
  const output = (value: R) =>
    setPlan((p) => ({ ...p, outputSpec: { ...p.outputSpec, ...value } }));
  const target = (index: number, value: R) =>
    output({
      targets: plan.outputSpec.targets.map((t: R, i: number) =>
        i === index ? { ...t, ...value } : t,
      ),
    });
  const updateInput = (index: number, value: R) =>
    patch({
      inputs: plan.inputs.map((item: R, i: number) =>
        i === index ? { ...item, ...value } : item,
      ),
    });
  const profile = profiles.find((p) => p.id === plan.profileId);
  const options = [
    ...new Map(
      [
        ...plan.inputs.map((i: R) => ({
          id: i.assetId,
          name: "固定参考",
          availability: "ready",
        })),
        ...assets,
      ].map((a) => [a.id, a]),
    ).values(),
  ];
  const reorder = (index: number, offset: number) => {
    const inputs = [...plan.inputs];
    [inputs[index], inputs[index + offset]] = [
      inputs[index + offset],
      inputs[index],
    ];
    patch({
      inputs: inputs.map((i: R, position: number) => ({ ...i, position })),
    });
  };
  return (
    <section
      className="my-3 grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3"
      aria-label="编辑图片方案"
    >
      <label className={settingsLabel}>
        操作
        <select
          className={settingsSelect}
          value={plan.operation}
          disabled={busy}
          onChange={(e) =>
            patch({
              operation: e.target.value,
              ...(e.target.value === "process"
                ? { prompt: "", profileId: null, parameters: {} }
                : {}),
            })
          }
        >
          <option value="process">精确处理</option>
          <option value="generate">生成图片</option>
          <option value="edit">修改图片内容</option>
        </select>
      </label>
      <label className={settingsLabel}>
        修改目标
        <input
          className={settingsInput}
          value={plan.intent}
          disabled={busy}
          onChange={(e) => patch({ intent: e.target.value })}
        />
      </label>
      <label className={settingsLabel}>
        保持内容
        <input
          className={settingsInput}
          value={plan.preserve}
          disabled={busy}
          onChange={(e) => patch({ preserve: e.target.value })}
        />
      </label>
      {plan.operation !== "process" && (
        <>
          <label className={settingsLabel}>
            图片描述
            <textarea
              className={settingsTextarea}
              value={plan.prompt}
              disabled={busy}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </label>
          <label className={settingsLabel}>
            图片模型
            <select
              className={settingsSelect}
              value={plan.profileId ?? ""}
              disabled={busy}
              onChange={(e) =>
                patch({ profileId: e.target.value || null, parameters: {} })
              }
            >
              <option value="">部署默认</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.modelId}
                </option>
              ))}
            </select>
          </label>
          {profile?.parameters.map((parameter: R) => (
            <label className={settingsLabel} key={parameter.key}>
              {parameter.description}
              {parameter.enum ? (
                <select
                  className={settingsSelect}
                  disabled={busy}
                  value={
                    plan.parameters[parameter.key] ?? parameter.default ?? ""
                  }
                  onChange={(e) =>
                    patch({
                      parameters: {
                        ...plan.parameters,
                        [parameter.key]:
                          parameter.type === "integer"
                            ? Number(e.target.value)
                            : e.target.value,
                      },
                    })
                  }
                >
                  {parameter.enum.map((v: unknown) => (
                    <option key={String(v)} value={String(v)}>
                      {String(v)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={settingsInput}
                  disabled={busy}
                  value={
                    plan.parameters[parameter.key] ?? parameter.default ?? ""
                  }
                  onChange={(e) =>
                    patch({
                      parameters: {
                        ...plan.parameters,
                        [parameter.key]:
                          parameter.type === "integer"
                            ? Number(e.target.value)
                            : e.target.value,
                      },
                    })
                  }
                />
              )}
            </label>
          ))}
        </>
      )}
      <div className="grid gap-2">
        <p className="m-0 text-xs font-medium">固定参考及源图顺序</p>
        {plan.inputs.map((input: R, index: number) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <span className="text-xs">图 {index + 1}</span>
            <select
              aria-label={`图 ${index + 1}`}
              className={`${settingsSelect} max-w-56`}
              value={input.assetId}
              disabled={busy}
              onChange={(e) => updateInput(index, { assetId: e.target.value })}
            >
              {options
                .filter((a) => a.availability === "ready")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.width ? ` · ${a.width}×${a.height}` : ""}
                  </option>
                ))}
            </select>
            <select
              aria-label={`图 ${index + 1} 用途`}
              className={`${settingsSelect} max-w-28`}
              value={input.purpose}
              disabled={busy}
              onChange={(e) => updateInput(index, { purpose: e.target.value })}
            >
              <option value="base">源图</option>
              <option value="reference">参考</option>
            </select>
            <Button
              type="button"
              disabled={busy || index === 0}
              onClick={() => reorder(index, -1)}
            >
              上移
            </Button>
            <Button
              type="button"
              disabled={busy || index === plan.inputs.length - 1}
              onClick={() => reorder(index, 1)}
            >
              下移
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                patch({
                  inputs: plan.inputs
                    .filter((_: R, i: number) => i !== index)
                    .map((i: R, position: number) => ({ ...i, position })),
                })
              }
            >
              移除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          disabled={
            busy ||
            plan.inputs.length >= 4 ||
            !options.some(
              (a) =>
                a.availability === "ready" &&
                !plan.inputs.some((i: R) => i.assetId === a.id),
            )
          }
          onClick={() => {
            const asset = options.find(
              (a) =>
                a.availability === "ready" &&
                !plan.inputs.some((i: R) => i.assetId === a.id),
            );
            if (asset)
              patch({
                inputs: [
                  ...plan.inputs,
                  {
                    assetId: asset.id,
                    purpose:
                      plan.operation === "generate" ? "reference" : "base",
                    position: plan.inputs.length,
                  },
                ],
              });
          }}
        >
          添加已选资源
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={settingsLabel}>
          格式
          <select
            className={settingsSelect}
            value={plan.outputSpec.format}
            disabled={busy}
            onChange={(e) => {
              const format = e.target.value;
              const { quality: _, ...spec } = plan.outputSpec;
              patch({
                outputSpec: {
                  ...spec,
                  format,
                  background:
                    format === "jpeg" && spec.background === "transparent"
                      ? "#FFFFFF"
                      : spec.background,
                  targets: spec.targets.map((t: R) => ({
                    ...t,
                    name: t.name.replace(
                      /\.[^.]+$/,
                      "." + (format === "jpeg" ? "jpg" : format),
                    ),
                  })),
                },
              });
            }}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label className={settingsLabel}>
          比例处理
          <select
            className={settingsSelect}
            value={plan.outputSpec.fit}
            disabled={busy}
            onChange={(e) => output({ fit: e.target.value })}
          >
            <option value="contain">保持比例并补边</option>
            <option value="cover">保持比例并裁剪</option>
          </select>
        </label>
        <label className={settingsLabel}>
          补边颜色
          <input
            className={settingsInput}
            placeholder="transparent 或 #FFFFFF"
            value={plan.outputSpec.background}
            disabled={busy}
            onChange={(e) => output({ background: e.target.value })}
          />
        </label>
        {plan.outputSpec.format !== "png" && (
          <label className={settingsLabel}>
            质量（1～100）
            <input
              className={settingsInput}
              type="number"
              min={1}
              max={100}
              value={plan.outputSpec.quality ?? 80}
              disabled={busy}
              onChange={(e) => output({ quality: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
      <div className="grid gap-2">
        <p className="m-0 text-xs font-medium">交付输出（源图序号从 1 开始）</p>
        {plan.outputSpec.targets.map((t: R, index: number) => (
          <div
            className="grid grid-cols-[minmax(100px,1fr)_72px_72px_64px_auto] gap-2"
            key={index}
          >
            <label className={settingsLabel}>
              文件名
              <input
                className={settingsInput}
                value={t.name}
                disabled={busy}
                onChange={(e) => target(index, { name: e.target.value })}
              />
            </label>
            <label className={settingsLabel}>
              宽
              <input
                type="number"
                min={1}
                max={8192}
                className={settingsInput}
                value={t.width}
                disabled={busy}
                onChange={(e) =>
                  target(index, { width: Number(e.target.value) })
                }
              />
            </label>
            <label className={settingsLabel}>
              高
              <input
                type="number"
                min={1}
                max={8192}
                className={settingsInput}
                value={t.height}
                disabled={busy}
                onChange={(e) =>
                  target(index, { height: Number(e.target.value) })
                }
              />
            </label>
            <label className={settingsLabel}>
              源图
              <input
                type="number"
                min={1}
                max={32}
                className={settingsInput}
                value={t.sourceIndex + 1}
                disabled={busy}
                onChange={(e) =>
                  target(index, { sourceIndex: Number(e.target.value) - 1 })
                }
              />
            </label>
            <Button
              type="button"
              className="self-end"
              disabled={busy || plan.outputSpec.targets.length === 1}
              onClick={() =>
                output({
                  targets: plan.outputSpec.targets.filter(
                    (_: R, i: number) => i !== index,
                  ),
                })
              }
            >
              移除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          disabled={busy || plan.outputSpec.targets.length >= 32}
          onClick={() =>
            output({
              targets: [
                ...plan.outputSpec.targets,
                {
                  name: `image-${plan.outputSpec.targets.length + 1}.${plan.outputSpec.format === "jpeg" ? "jpg" : plan.outputSpec.format}`,
                  width: 1024,
                  height: 1024,
                  sourceIndex: 0,
                },
              ],
            })
          }
        >
          添加输出
        </Button>
      </div>
      <footer className="flex justify-end gap-2">
        <Button type="button" disabled={busy} onClick={onClose}>
          收起编辑
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          onClick={() => onSave(plan)}
        >
          保存新方案
        </Button>
      </footer>
    </section>
  );
}
