import React, { useEffect, useState } from 'react';
import { ProjectMeta } from '../domain/types';

interface ProjectSidebarProps {
  projects: ProjectMeta[];
  activeProjectId: string;
  onImport: () => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onClose: () => void;
}

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectId,
  onImport,
  onOpenProject,
  onDeleteProject,
  onClose,
}) => {
  const formatTitle = (title: string) => truncateProjectTitle(title);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);

  useEffect(() => {
    const closeDeleteMenu = () => setDeleteProjectId(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDeleteMenu();
      }
    };

    document.addEventListener('click', closeDeleteMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', closeDeleteMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <aside className="project-sidebar" aria-label="文件列表">
      <div className="project-sidebar-header">
        <div className="project-sidebar-title-row">
          <h2 className="project-sidebar-title">文件</h2>
          <button className="sidebar-close-button" onClick={onClose} title="收起文件栏">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.33 4.38H16.67" />
              <path d="M10 8.13H16.67" />
              <path d="M10 11.88H16.67" />
              <path d="M3.33 15.62H16.67" />
              <path d="M3.33 8.13L6.67 10L3.33 11.88" />
            </svg>
          </button>
        </div>
        <button className="sidebar-import-button" onClick={onImport}>
          <span aria-hidden="true">+</span>
          <span>导入</span>
        </button>
      </div>

      <div className="project-sidebar-list">
        {projects.length === 0 && (
          <p className="project-sidebar-empty">暂无文件</p>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            className={`project-sidebar-row ${
              deleteProjectId === project.id ? 'is-delete-open' : ''
            }`}
            onContextMenu={(event) => {
              event.preventDefault();
              setDeleteProjectId(project.id);
            }}
          >
            <button
              className={`project-sidebar-item ${
                project.id === activeProjectId ? 'active' : ''
              }`}
              onClick={() => {
                setDeleteProjectId(null);
                onOpenProject(project.id);
              }}
              title={project.title}
            >
              {formatTitle(project.title)}
            </button>
            <button
              className="project-delete-popover project-sidebar-delete"
              onClick={(event) => {
                event.stopPropagation();
                setDeleteProjectId(null);
                onDeleteProject(project.id);
              }}
              aria-label={`删除 ${project.title}`}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
};

function truncateProjectTitle(title: string): string {
  let units = 0;
  let output = '';

  for (const char of title.trim()) {
    const nextUnits = /[\u4e00-\u9fff]/.test(char) ? 2 : 1;
    if (units + nextUnits > 32) {
      return `${output}...`;
    }
    units += nextUnits;
    output += char;
  }

  return output;
}

export default ProjectSidebar;
