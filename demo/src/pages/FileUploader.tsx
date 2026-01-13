import { useState, useEffect, useRef } from "react";

interface FileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export function FileUploader() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      setFiles(data.files || []);
    } catch (error) {
      console.error("Failed to fetch files:", error);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage("Please select a file first");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`Uploaded: ${data.name} (${formatSize(data.size)})`);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        fetchFiles();
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Upload failed: ${error}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setMessage(`Deleted: ${filename}`);
        fetchFiles();
      } else {
        const data = await res.json();
        setMessage(`Delete failed: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Delete failed: ${error}`);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="page file-uploader-page">
      <h1>File Uploader</h1>
      <p>Upload and manage files via QuickJS fs API</p>

      <div className="upload-section">
        <h3>Upload File</h3>
        <div className="upload-form">
          <input type="file" ref={fileInputRef} className="file-input" />
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="upload-button"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
        {message && <p className="message">{message}</p>}
      </div>

      <div className="files-section">
        <h3>Uploaded Files</h3>
        <button onClick={fetchFiles} className="refresh-button">
          Refresh
        </button>

        {files.length === 0 ? (
          <p className="no-files">No files uploaded yet</p>
        ) : (
          <table className="files-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.name}>
                  <td>{file.name}</td>
                  <td>{formatSize(file.size)}</td>
                  <td>{file.type || "unknown"}</td>
                  <td className="actions">
                    <a
                      href={`/api/files/${encodeURIComponent(file.name)}`}
                      download={file.name}
                      className="download-link"
                    >
                      Download
                    </a>
                    <button
                      onClick={() => handleDelete(file.name)}
                      className="delete-button"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
