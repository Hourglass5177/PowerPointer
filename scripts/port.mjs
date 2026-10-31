// Windows can reserve blocks inside its dynamic port range (here 1024-15000, by default 49152+).
export const defaultPort = 17317;

export function listenFailure(error, port) {
  const next = port === defaultPort ? defaultPort + 1 : defaultPort;
  const retry = `请在 PowerShell 运行 $env:PORT='${next}' 后，在同一窗口重新启动。`;
  if (error.code === "EACCES") return `无法使用端口 ${port}：Windows 已保留该端口或拒绝访问。${retry}`;
  if (error.code === "EADDRINUSE") return `无法使用端口 ${port}：它已被其他程序占用。${retry}`;
  return `无法启动本地服务：${error.message}`;
}
