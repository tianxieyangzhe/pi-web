import {SessionMemoryContextEditor} from "../inspector/session-memory-context-editor";
import {blankContext,type SessionMemoryContext} from "../../domain/session-memory";
import {useEffect,useState} from "react";
import {api} from "../../api/client";
import type {SessionMemory} from "../../domain/session-memory";
import { ArrowRight, FolderKanban, Plus, X } from "lucide-react";
import type { Project } from "../../domain/models";

export function ProjectSessionCreateDialog({
  projects,
  creatingProjectId,
  onClose,
  onSelectProject,
  onCreateProject,
  libraryOnly=false,
}: {
  libraryOnly?:boolean;
  projects: Project[];
  creatingProjectId: string | null;
  onClose: () => void;
  onSelectProject: (projectId: string, template?: {sessionMemoryTemplateId:string;templateWriteETag:string}) => void;
  onCreateProject: () => void;
}) {
  const [templates,setTemplates]=useState<Array<{sessionMemory:SessionMemory;writeETag:string}>>([]);
  const [templateEditing,setTemplateEditing]=useState(false);
  const [templateTitle,setTemplateTitle]=useState("");
  const [templateForm,setTemplateForm]=useState<SessionMemoryContext>(blankContext);
  const [templateId,setTemplateId]=useState<string|null>(null);
  const [templateETag,setTemplateETag]=useState<string|null>(null);
  const [templateBusy,setTemplateBusy]=useState(false);
  const [selected,setSelected]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{void api.listSessionMemoryTemplates().then(setTemplates).catch(cause=>setError(cause instanceof Error?cause.message:"无法读取模板"));},[]);
  const template=templates.find(item=>item.sessionMemory.id===selected);
  return (
    <div className="modal-backdrop">
      <section className="modal project-session-create" role="dialog" aria-modal="true" aria-labelledby="project-session-create-title">
        <header>
          <div>
            <h2 id="project-session-create-title">{libraryOnly?"记忆模板库":"新建项目会话"}</h2>
            <p className="modal__description">模板保存通用目标与约束，复制后成为独立的初始记忆。</p>
          </div>
          <button aria-label="关闭新建项目会话" onClick={onClose}><X size={16} /></button>
        </header>
        <label>会话上下文<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">空记忆</option>{templates.map(item=><option key={item.sessionMemory.id} value={item.sessionMemory.id}>{item.sessionMemory.title}</option>)}</select></label>
        <div><button type="button" onClick={()=>{setTemplateId(null);setTemplateETag(null);setTemplateTitle("");setTemplateForm(blankContext());setTemplateEditing(true);}}>新建 记忆模板</button>{template&&<button type="button" onClick={()=>{setTemplateId(template.sessionMemory.id);setTemplateETag(template.writeETag);setTemplateTitle(template.sessionMemory.title);setTemplateForm(structuredClone(template.sessionMemory.contextJson));setTemplateEditing(true);}}>编辑此模板</button>}</div>
        {templateEditing&&<section><label>模板标题<input value={templateTitle} maxLength={120} onChange={event=>setTemplateTitle(event.target.value)}/></label><SessionMemoryContextEditor template value={templateForm} onChange={setTemplateForm} disabled={templateBusy}/><button disabled={templateBusy} type="button" onClick={()=>{setTemplateBusy(true);void api.saveSessionMemoryTemplate(templateId,templateETag,{title:templateTitle,context:templateForm}).then(async result=>{setTemplates(await api.listSessionMemoryTemplates());setSelected(result.id);setTemplateEditing(false);}).catch(cause=>setError(cause instanceof Error?cause.message:"模板保存失败")).finally(()=>setTemplateBusy(false));}}>保存模板</button><button type="button" onClick={()=>setTemplateEditing(false)}>取消模板编辑</button></section>}
        {error&&<p role="alert">{error}</p>}{template&&<div><p>模板复制到新会话后直接作为初始记忆。</p><p>{template.sessionMemory.contextJson.summary}</p><p>目标：{template.sessionMemory.contextJson.goal}</p><ul>{template.sessionMemory.contextJson.constraints.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}
        {libraryOnly ? <p>选择模板查看或编辑；新建会话时可复制到项目。</p> : projects.length > 0 ? (
          <div className="project-session-picker" aria-label="选择项目">
            {projects.map((project) => {
              const creating = creatingProjectId === project.id;
              return (
                <button
                  className="project-session-picker__option"
                  key={project.id}
                  type="button"
                  disabled={creatingProjectId !== null||templateEditing}
                  onClick={() => onSelectProject(project.id,template?{sessionMemoryTemplateId:template.sessionMemory.id,templateWriteETag:template.writeETag}:undefined)}
                >
                  <FolderKanban size={16} aria-hidden="true" />
                  <span className="project-session-picker__name">{project.name}</span>
                  <span className="project-session-picker__action">{creating ? "创建中…" : "新建并进入"}<ArrowRight size={14} aria-hidden="true" /></span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="project-session-create__empty">
            <p>还没有可用项目。先创建一个项目，再新建项目会话。</p>
            <button className="primary" type="button" onClick={onCreateProject}><Plus size={14} />新建项目</button>
          </div>
        )}
        <footer><button type="button" onClick={onClose}>取消</button></footer>
      </section>
    </div>
  );
}
