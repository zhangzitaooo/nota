import React, { useEffect, useState } from 'react';
import { ProjectMeta } from '../domain/types';

interface ImportScreenProps {
  onImport: () => void;
  projects: ProjectMeta[];
  loadingProjects: boolean;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}

const ImportScreen: React.FC<ImportScreenProps> = ({
  onImport,
  projects,
  loadingProjects,
  onOpenProject,
  onDeleteProject,
}) => {
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
    <div className="import-screen">
      <main className="import-home">
        <button className="btn-import import-primary-action" onClick={onImport}>
          <span className="import-plus" aria-hidden="true">+</span>
          <span>导入论文</span>
        </button>
        <section className="recent-projects" aria-label="最近文件">
          <h1 className="recent-projects-title">文件</h1>
          {loadingProjects && <p className="recent-projects-empty">正在读取文件...</p>}
          {!loadingProjects && projects.length === 0 && (
            <p className="recent-projects-empty">导入第一篇论文后，会显示在这里。</p>
          )}
          {!loadingProjects && projects.length > 0 && (
            <div className="recent-projects-list">
              {projects.slice(0, 6).map((project) => (
                <div
                  key={project.id}
                  className={`recent-project-row ${
                    deleteProjectId === project.id ? 'is-delete-open' : ''
                  }`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDeleteProjectId(project.id);
                  }}
                >
                  <button
                    className="recent-project-item"
                    onClick={() => {
                      setDeleteProjectId(null);
                      onOpenProject(project.id);
                    }}
                    title={project.title}
                  >
                    <span className="recent-project-name">{project.title}</span>
                  </button>
                  <button
                    className="project-delete-popover recent-project-delete"
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
          )}
        </section>
      </main>
    </div>
  );
};

export default ImportScreen;
