/** Remove invisible title watermarks before clipping; retain joiners inside text/emoji. */
export function cleanTaskText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/g, '')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim()
}

export function clipTaskText(value: string, max: number): string {
  return Array.from(cleanTaskText(value)).slice(0, max).join('')
}
