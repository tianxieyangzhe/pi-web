"use client";

import {
  FileTree,
  FileTreeActions,
  FileTreeFile,
  FileTreeFolder,
  FileTreeIcon,
  FileTreeName,
} from "@/shared/ui/ai-elements/file-tree";
import type { ReactNode } from "react";
import { useMemo } from "react";

export type ProjectFileTreeEntry = {
  path: string;
  parentPath: string;
  name: string;
  type: "file" | "directory";
  gitStatus?:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "untracked"
    | "conflicted";
};

type ProjectFileTreeProps = {
  entries: ProjectFileTreeEntry[];
  expanded: Set<string>;
  selectedPath?: string;
  onExpandedChange: (expanded: Set<string>) => void;
  onFolderToggle?: (path: string, expanded: boolean) => void;
  onSelect: (entry: ProjectFileTreeEntry) => void;
  renderFileIcon?: (entry: ProjectFileTreeEntry) => ReactNode;
  className?: string;
};

const gitStatusLabel: Record<
  NonNullable<ProjectFileTreeEntry["gitStatus"]>,
  string
> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "!",
};

export function ProjectFileTree({
  entries,
  expanded,
  selectedPath,
  onExpandedChange,
  onFolderToggle,
  onSelect,
  renderFileIcon,
  className,
}: ProjectFileTreeProps) {
  const entriesByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );
  const childrenByParent = useMemo(() => {
    const result = new Map<string, ProjectFileTreeEntry[]>();

    for (const entry of entries) {
      const siblings = result.get(entry.parentPath) ?? [];
      siblings.push(entry);
      result.set(entry.parentPath, siblings);
    }

    for (const siblings of result.values()) {
      siblings.sort(
        (left, right) =>
          Number(right.type === "directory") -
            Number(left.type === "directory") ||
          left.name.localeCompare(right.name, "en", {
            numeric: true,
            sensitivity: "base",
          }),
      );
    }

    return result;
  }, [entries]);

  function renderChildren(parentPath = ""): ReactNode {
    return (childrenByParent.get(parentPath) ?? []).map((entry) => {
      if (entry.type === "directory") {
        return (
          <FileTreeFolder key={entry.path} name={entry.name} path={entry.path}>
            {renderChildren(entry.path)}
          </FileTreeFolder>
        );
      }

      return (
        <FileTreeFile
          className="hover:bg-slate-100"
          key={entry.path}
          name={entry.name}
          path={entry.path}
        >
          <span className="size-4 shrink-0" />
          <FileTreeIcon>{renderFileIcon?.(entry)}</FileTreeIcon>
          <FileTreeName>{entry.name}</FileTreeName>
          {entry.gitStatus ? (
            <FileTreeActions>
              <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                {gitStatusLabel[entry.gitStatus]}
              </span>
            </FileTreeActions>
          ) : null}
        </FileTreeFile>
      );
    });
  }

  return (
    <FileTree
      className={className}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      onFolderToggle={onFolderToggle}
      onSelect={(path) => {
        const entry = entriesByPath.get(path);
        if (entry) onSelect(entry);
      }}
      selectedPath={selectedPath}
    >
      {renderChildren()}
    </FileTree>
  );
}
