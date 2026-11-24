export async function command<T = unknown>(
  name: string,
  body: unknown = {},
): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "操作失败，请重试");
  return data;
}
export async function importPdf(file: File, pages: string) {
  const res = await fetch(
    "/api/import?" + new URLSearchParams({ name: file.name, pages }),
    {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    },
  );
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "导入失败");
  return data;
}
export const assetUrl = (paperId: string, file: string) =>
  `/papers/${encodeURIComponent(paperId)}/${encodeURIComponent(file)}`;
