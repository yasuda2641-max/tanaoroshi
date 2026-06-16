export async function decodeCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  if (hasUtf8Bom) {
    return new TextDecoder('utf-8').decode(buffer);
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const fffdCount = (utf8.match(/\uFFFD/g) ?? []).length;
  const isShiftJis = fffdCount / utf8.length > 0.001;
  return isShiftJis ? new TextDecoder('shift-jis').decode(buffer) : utf8;
}
