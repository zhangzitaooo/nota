import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface ProjectMeta {
  id: string;
  title: string;
  sourcePdfPath: string;
  createdAt: string;
  updatedAt: string;
}

const SAFE_PROJECT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export class ProjectStore {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(app.getPath('documents'), 'PaperReadingWorkbench', 'projects');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** 创建新项目 */
  createProject(pdfPath: string): { projectId: string; projectDir: string } {
    const pdfName = path.basename(pdfPath, '.pdf');
    const slug = pdfName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const projectId = `${dateStr}-${slug}`;

    const projectDir = path.join(this.baseDir, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // 复制 PDF 到项目目录
    const targetPdfPath = path.join(projectDir, 'source.pdf');
    fs.copyFileSync(pdfPath, targetPdfPath);

    // 创建 meta.json
    const meta: ProjectMeta = {
      id: projectId,
      title: path.basename(pdfPath, '.pdf'),
      sourcePdfPath: targetPdfPath,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    fs.writeFileSync(path.join(projectDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    return { projectId, projectDir };
  }

  /** 加载项目信息 */
  loadProject(projectId: string): ProjectMeta | null {
    const metaPath = this.resolveProjectFile(projectId, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  /** 删除项目。只删除应用复制到项目目录中的数据，不影响用户原始 PDF。 */
  deleteProject(projectId: string): void {
    const resolvedProjectDir = this.resolveProjectDir(projectId);

    if (fs.existsSync(resolvedProjectDir)) {
      fs.rmSync(resolvedProjectDir, { recursive: true, force: true });
    }
  }

  /** 列出所有项目 */
  listProjects(): ProjectMeta[] {
    if (!fs.existsSync(this.baseDir)) return [];
    const dirs = fs.readdirSync(this.baseDir, { withFileTypes: true });
    return dirs
      .filter((d) => d.isDirectory())
      .map((d) => {
        if (!this.isSafeProjectId(d.name)) {
          return null;
        }

        const metaPath = this.resolveProjectFile(d.name, 'meta.json');
        const documentPath = this.resolveProjectFile(d.name, 'document.json');
        if (fs.existsSync(metaPath) && fs.existsSync(documentPath)) {
          return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        }
        return null;
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date((b as ProjectMeta).updatedAt).getTime() -
          new Date((a as ProjectMeta).updatedAt).getTime()
      ) as ProjectMeta[];
  }

  assertSafeProjectId(projectId: string): void {
    if (!this.isSafeProjectId(projectId)) {
      throw new Error('非法项目 ID');
    }
  }

  resolveProjectDir(projectId: string): string {
    this.assertSafeProjectId(projectId);

    const resolvedBaseDir = path.resolve(this.baseDir);
    const resolvedProjectDir = path.resolve(resolvedBaseDir, projectId);

    if (
      resolvedProjectDir === resolvedBaseDir ||
      !this.isInsidePath(resolvedBaseDir, resolvedProjectDir)
    ) {
      throw new Error('非法项目路径');
    }

    return resolvedProjectDir;
  }

  resolveProjectFile(projectId: string, fileName: string): string {
    if (
      typeof fileName !== 'string' ||
      !fileName ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      path.isAbsolute(fileName)
    ) {
      throw new Error('非法项目文件名');
    }

    const projectDir = this.resolveProjectDir(projectId);
    const resolvedFilePath = path.resolve(projectDir, fileName);

    if (!this.isInsidePath(projectDir, resolvedFilePath)) {
      throw new Error('非法项目文件路径');
    }

    return resolvedFilePath;
  }

  resolveProjectAsset(projectId: string, assetPath: string): string {
    if (typeof assetPath !== 'string' || !assetPath || path.isAbsolute(assetPath)) {
      throw new Error('非法资源路径');
    }

    const projectDir = this.resolveProjectDir(projectId);
    const resolvedAssetPath = path.resolve(projectDir, assetPath);

    if (!this.isInsidePath(projectDir, resolvedAssetPath)) {
      throw new Error('非法资源路径');
    }

    return resolvedAssetPath;
  }

  getAssetsDir(projectId: string): string {
    const assetsDir = path.resolve(this.resolveProjectDir(projectId), 'assets');
    if (!this.isInsidePath(this.resolveProjectDir(projectId), assetsDir)) {
      throw new Error('非法资源目录');
    }

    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    return assetsDir;
  }

  readAssetDataUrl(projectId: string, assetPath: string): string | null {
    const absolutePath = this.resolveProjectAsset(projectId, assetPath);
    if (!fs.existsSync(absolutePath)) {
      return null;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const data = fs.readFileSync(absolutePath).toString('base64');
    return `data:${mimeType};base64,${data}`;
  }

  /** 保存 document.json */
  saveDocument(projectId: string, document: any): void {
    const filePath = this.resolveProjectFile(projectId, 'document.json');
    fs.writeFileSync(filePath, JSON.stringify(document, null, 2), 'utf-8');
    this.updateMeta(projectId);
  }

  /** 读取 document.json */
  loadDocument(projectId: string): any | null {
    const filePath = this.resolveProjectFile(projectId, 'document.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  /** 保存 annotations.json */
  saveAnnotations(projectId: string, annotations: any[]): void {
    const filePath = this.resolveProjectFile(projectId, 'annotations.json');
    fs.writeFileSync(filePath, JSON.stringify(annotations, null, 2), 'utf-8');
  }

  /** 读取 annotations.json */
  loadAnnotations(projectId: string): any[] {
    const filePath = this.resolveProjectFile(projectId, 'annotations.json');
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  /** 保存 chats.json */
  saveChats(projectId: string, chats: any[]): void {
    const filePath = this.resolveProjectFile(projectId, 'chats.json');
    fs.writeFileSync(filePath, JSON.stringify(chats, null, 2), 'utf-8');
  }

  /** 读取 chats.json */
  loadChats(projectId: string): any[] {
    const filePath = this.resolveProjectFile(projectId, 'chats.json');
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  private updateMeta(projectId: string): void {
    const metaPath = this.resolveProjectFile(projectId, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    }
  }

  private isSafeProjectId(projectId: string): boolean {
    return (
      typeof projectId === 'string' &&
      projectId.length > 0 &&
      projectId !== '.' &&
      projectId !== '..' &&
      SAFE_PROJECT_ID_PATTERN.test(projectId)
    );
  }

  private isInsidePath(parentPath: string, childPath: string): boolean {
    const relativePath = path.relative(parentPath, childPath);
    return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }
}
