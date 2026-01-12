import type { FileSystemHandler } from "@ricsam/isolate-fs";

/**
 * In-memory file system implementation for testing.
 * Implements the FileSystemHandler interface from @ricsam/isolate-fs.
 */
export class MockFileSystem implements FileSystemHandler {
  files = new Map<
    string,
    { data: Uint8Array; lastModified: number; type: string }
  >();
  directories = new Set<string>(["/"]);

  async getFileHandle(
    path: string,
    options?: { create?: boolean }
  ): Promise<void> {
    const exists = this.files.has(path);
    if (!exists && !options?.create) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    if (this.directories.has(path)) {
      throw new Error("[TypeMismatchError]Path is a directory: " + path);
    }
    if (!exists && options?.create) {
      this.files.set(path, {
        data: new Uint8Array(0),
        lastModified: Date.now(),
        type: "",
      });
    }
  }

  async getDirectoryHandle(
    path: string,
    options?: { create?: boolean }
  ): Promise<void> {
    const exists = this.directories.has(path);
    if (!exists && !options?.create) {
      throw new Error("[NotFoundError]Directory not found: " + path);
    }
    if (this.files.has(path)) {
      throw new Error("[TypeMismatchError]Path is a file: " + path);
    }
    if (!exists && options?.create) {
      this.directories.add(path);
    }
  }

  async removeEntry(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }

    if (this.directories.has(path)) {
      const prefix = path === "/" ? "/" : path + "/";
      const hasChildren =
        [...this.files.keys()].some((p) => p.startsWith(prefix)) ||
        [...this.directories].some((p) => p !== path && p.startsWith(prefix));

      if (hasChildren && !options?.recursive) {
        throw new Error("[InvalidModificationError]Directory not empty: " + path);
      }

      for (const p of this.files.keys()) {
        if (p.startsWith(prefix)) {
          this.files.delete(p);
        }
      }
      for (const p of this.directories) {
        if (p.startsWith(prefix) || p === path) {
          this.directories.delete(p);
        }
      }
      return;
    }

    throw new Error("[NotFoundError]Entry not found: " + path);
  }

  async readDirectory(
    path: string
  ): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
    if (!this.directories.has(path)) {
      throw new Error("[NotFoundError]Directory not found: " + path);
    }

    const prefix = path === "/" ? "/" : path + "/";
    const entries: Array<{ name: string; kind: "file" | "directory" }> = [];
    const seen = new Set<string>();

    for (const p of this.files.keys()) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/") && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, kind: "file" });
        }
      }
    }

    for (const p of this.directories) {
      if (p !== path && p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/") && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, kind: "directory" });
        }
      }
    }

    return entries;
  }

  async readFile(
    path: string
  ): Promise<{ data: Uint8Array; size: number; lastModified: number; type: string }> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    return {
      data: file.data,
      size: file.data.length,
      lastModified: file.lastModified,
      type: file.type,
    };
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    position?: number
  ): Promise<void> {
    const existing = this.files.get(path);
    if (!existing) {
      throw new Error("[NotFoundError]File not found: " + path);
    }

    if (position !== undefined && position > 0) {
      const newSize = Math.max(existing.data.length, position + data.length);
      const newData = new Uint8Array(newSize);
      newData.set(existing.data);
      newData.set(data, position);
      existing.data = newData;
    } else if (position === 0) {
      const newSize = Math.max(existing.data.length, data.length);
      const newData = new Uint8Array(newSize);
      newData.set(existing.data);
      newData.set(data, 0);
      existing.data = newData;
    } else {
      existing.data = data;
    }
    existing.lastModified = Date.now();
  }

  async truncateFile(path: string, size: number): Promise<void> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    if (size < file.data.length) {
      file.data = file.data.slice(0, size);
    } else if (size > file.data.length) {
      const newData = new Uint8Array(size);
      newData.set(file.data);
      file.data = newData;
    }
    file.lastModified = Date.now();
  }

  async getFileMetadata(
    path: string
  ): Promise<{ size: number; lastModified: number; type: string }> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    return {
      size: file.data.length,
      lastModified: file.lastModified,
      type: file.type,
    };
  }

  // Test helper methods

  /**
   * Reset the mock file system to its initial state (empty, with only root directory)
   */
  reset(): void {
    this.files.clear();
    this.directories.clear();
    this.directories.add("/");
  }

  /**
   * Convenience method to set a file with string or binary content
   */
  setFile(path: string, content: string | Uint8Array, type?: string): void {
    const data =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
    this.files.set(path, {
      data,
      lastModified: Date.now(),
      type: type ?? "",
    });
  }

  /**
   * Get file content as Uint8Array, or undefined if not found
   */
  getFile(path: string): Uint8Array | undefined {
    return this.files.get(path)?.data;
  }

  /**
   * Get file content as string, or undefined if not found
   */
  getFileAsString(path: string): string | undefined {
    const data = this.getFile(path);
    if (!data) return undefined;
    return new TextDecoder().decode(data);
  }

  /**
   * Create a directory (and any necessary parent directories)
   */
  createDirectory(path: string): void {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      this.directories.add(current);
    }
  }
}
