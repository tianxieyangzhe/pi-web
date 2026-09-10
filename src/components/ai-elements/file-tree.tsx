"use client";

import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback((path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) newExpanded.delete(path);
    else newExpanded.add(path);
    setInternalExpanded(newExpanded);
    onExpandedChange?.(newExpanded);
  }, [expandedPaths, onExpandedChange]);

  const contextValue = useMemo(
    () => ({ expandedPaths, onSelect, selectedPath, togglePath }),
    [expandedPaths, onSelect, selectedPath, togglePath]
  );

  return <FileTreeContext.Provider value={contextValue}><div className={cn("rounded-lg border bg-background font-mono text-sm", className)} role="tree" {...props}><div className="p-2">{children}</div></div></FileTreeContext.Provider>;
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;
export const FileTreeIcon = ({ className, children, ...props }: FileTreeIconProps) => <span className={cn("ai-file-tree-icon shrink-0", className)} {...props}>{children}</span>;

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;
export const FileTreeName = ({ className, children, ...props }: FileTreeNameProps) => <span className={cn("ai-file-tree-name truncate", className)} {...props}>{children}</span>;

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & { path: string; name: string };
export const FileTreeFolder = ({ path, name, className, children, ...props }: FileTreeFolderProps) => {
  const { expandedPaths, togglePath, selectedPath } = useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;
  const toggleFolder = useCallback(() => togglePath(path), [togglePath, path]);
  return <div className={cn("ai-file-tree-folder", className)} role="treeitem" {...props}><button className={cn("ai-file-tree-folder-row flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50", isSelected && "bg-muted")} onClick={toggleFolder} type="button" aria-expanded={isExpanded}><ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-90")} /><FileTreeIcon>{isExpanded ? <FolderOpenIcon className="size-3 text-blue-500" /> : <FolderIcon className="size-3 text-blue-500" />}</FileTreeIcon><FileTreeName>{name}</FileTreeName></button>{isExpanded && <div className="ai-file-tree-children">{children}</div>}</div>;
};

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & { path: string; name: string; icon?: ReactNode };
export const FileTreeFile = ({ path, name, icon, className, children, ...props }: FileTreeFileProps) => {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;
  const handleClick = useCallback(() => onSelect?.(path), [onSelect, path]);
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") onSelect?.(path);
  }, [onSelect, path]);

  return <div className={cn("ai-file-tree-file flex min-w-0 cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50", isSelected && "bg-muted", className)} onClick={handleClick} onKeyDown={handleKeyDown} role="treeitem" tabIndex={0} {...props}>{children ?? <><span className="size-4 shrink-0"/><FileTreeIcon>{icon ?? <FileIcon className="size-4 text-muted-foreground" />}</FileTreeIcon><FileTreeName>{name}</FileTreeName></>}</div>;
};

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;
export const FileTreeActions = ({ className, children, ...props }: FileTreeActionsProps) => <div className={cn("ml-auto flex items-center gap-1", className)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="group" {...props}>{children}</div>;
