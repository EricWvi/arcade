const relative = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

/** "刚刚", "5 分钟前", "昨天"… for a unix millisecond time in the past. */
export function timeAgo(ms: number, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return relative.format(-days, "day");
  return new Date(ms).toLocaleDateString("zh-CN");
}

/** "不到 1 分钟", "25 分钟", "3 小时 10 分钟" for a duration. */
export function playTime(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} 分钟`;
  return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分钟` : `${hours} 小时`;
}
