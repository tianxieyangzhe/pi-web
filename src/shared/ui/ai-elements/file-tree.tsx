"use client";

import { cn } from "@/shared/lib/cn";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface FileTreeContextValue {
  expandedPaths: Set<string>;
  selectedPath?: string;
  togglePath: (path: string) => void;
  onFolderToggle?: (path: string, expanded: boolean) => void;
  onSelect?: (path: string) => void;
}

const FileTreeContext = createContext<FileTreeContextValue>({
  expandedPaths: new Set(),
  togglePath: () => undefined,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
  onFolderToggle?: (path: string, expanded: boolean) => void;
};

export function FileTree({
  expanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onExpandedChange,
  onFolderToggle,
  className,
  children,
  ...props
}: FileTreeProps) {
  const [internalExpanded, setInternalExpanded] = useState(
    () => new Set(defaultExpanded),
  );
  const expandedPaths = expanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const nextExpanded = new Set(expandedPaths);
      if (nextExpanded.has(path)) {
        nextExpanded.delete(path);
      } else {
        nextExpanded.add(path);
      }

      if (expanded === undefined) {
        setInternalExpanded(nextExpanded);
      }
      onExpandedChange?.(nextExpanded);
      onFolderToggle?.(path, !expandedPaths.has(path));
    },
    [expanded, expandedPaths, onExpandedChange, onFolderToggle],
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onSelect, selectedPath, togglePath, onFolderToggle }),
    [expandedPaths, onSelect, selectedPath, togglePath, onFolderToggle],
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn("font-mono text-sm", className)}
        role="tree"
        {...props}
      >
        {children}
      </div>
    </FileTreeContext.Provider>
  );
}

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export function FileTreeIcon({
  className,
  children,
  ...props
}: FileTreeIconProps) {
  return (
    <span className={cn("ai-file-tree-icon shrink-0", className)} {...props}>
      {children}
    </span>
  );
}

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export function FileTreeName({
  className,
  children,
  ...props
}: FileTreeNameProps) {
  return (
    <span className={cn("ai-file-tree-name truncate", className)} {...props}>
      {children}
    </span>
  );
}

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
};

export function FileTreeFolder({
  path,
  name,
  className,
  children,
  ...props
}: FileTreeFolderProps) {
  const { expandedPaths, onSelect, selectedPath, togglePath } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;

  return (
    <div
      className={cn("ai-file-tree-folder", className)}
      role="treeitem"
      aria-expanded={isExpanded}
      {...props}
    >
      <div
        className={cn(
          "ai-file-tree-folder-row flex min-w-0 items-center rounded transition-colors hover:bg-muted/50",
          isSelected && "bg-muted",
        )}
      >
        <button
          aria-label={isExpanded ? `收起 ${name}` : `展开 ${name}`}
          className="flex size-7 shrink-0 items-center justify-center rounded"
          onClick={() => togglePath(path)}
          type="button"
        >
          <ChevronRightIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        <button
          aria-label={isExpanded ? `收起 ${name}` : `展开 ${name}`}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 pr-2 text-left"
          onClick={() => togglePath(path)}
          type="button"
        >
          <FileTreeIcon>
            {isExpanded ? (
              <FolderOpenIcon className="size-4 text-blue-500" />
            ) : (
              <FolderIcon className="size-4 text-blue-500" />
            )}
          </FileTreeIcon>
          <FileTreeName>{name}</FileTreeName>
        </button>
      </div>
      {isExpanded ? (
        <div className="pl-4" role="group">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
};

export function FileTreeFile({
  path,
  name,
  icon,
  className,
  children,
  ...props
}: FileTreeFileProps) {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect?.(path);
      }
    },
    [onSelect, path],
  );

  return (
    <div
      className={cn(
        "ai-file-tree-file flex min-w-0 cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
        isSelected && "bg-muted",
        className,
      )}
      onClick={() => onSelect?.(path)}
      onKeyDown={handleKeyDown}
      role="treeitem"
      tabIndex={0}
      {...props}
    >
      {children ?? (
        <>
          <span className="size-4 shrink-0" />
          <FileTreeIcon>
            {icon ?? <FileIcon className="size-4 text-muted-foreground" />}
          </FileTreeIcon>
          <FileTreeName>{name}</FileTreeName>
        </>
      )}
    </div>
  );
}

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

export function FileTreeActions({
  className,
  children,
  ...props
}: FileTreeActionsProps) {
  return (
    <div
      className={cn("ml-auto flex items-center gap-1", className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="group"
      {...props}
    >
      {children}
    </div>
  );
}
