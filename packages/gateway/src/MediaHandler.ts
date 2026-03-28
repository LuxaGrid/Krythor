// ─── MediaHandler ─────────────────────────────────────────────────────────────
//
// Handles inbound media attachments from chat channels.
// Converts images, audio, and video to text descriptions for the LLM.
//
// Current capabilities (all optional — gracefully skipped if unavailable):
//   image  — base64 encode and pass to vision-capable model
//   audio  — return "[Audio received: <filename>, N bytes — transcription not configured]"
//   video  — return "[Video received: <filename>, N bytes — video analysis not configured]"
//
// Future: wire in whisper for audio, frame extraction for video.
//

export type MediaType = 'image' | 'audio' | 'video' | 'file';

export interface InboundMedia {
  type:     MediaType;
  filename: string;
  mimeType: string;
  data:     Buffer;
}

export interface MediaHandlerResult {
  textRepresentation: string;
  /** Base64 data URI for images — can be passed to vision-capable models */
  dataUri?: string;
}

/** Maximum image size to process (2 MB) */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export class MediaHandler {
  /**
   * Convert inbound media to a text representation suitable for injection
   * into the agent's conversation context.
   */
  async handle(media: InboundMedia): Promise<MediaHandlerResult> {
    switch (media.type) {
      case 'image':
        return this.handleImage(media);
      case 'audio':
        return {
          textRepresentation: `[Audio received: ${media.filename}, ${media.data.length} bytes — audio transcription not configured. To enable, add a speech_provider.]`,
        };
      case 'video':
        return {
          textRepresentation: `[Video received: ${media.filename}, ${media.data.length} bytes — video analysis not configured.]`,
        };
      default:
        return {
          textRepresentation: `[File received: ${media.filename}, ${media.data.length} bytes, type: ${media.mimeType}]`,
        };
    }
  }

  private handleImage(media: InboundMedia): MediaHandlerResult {
    if (media.data.length > MAX_IMAGE_BYTES) {
      return {
        textRepresentation: `[Image received: ${media.filename}, ${(media.data.length / 1024).toFixed(0)} KB — too large to process (max 2 MB). Send a smaller image.]`,
      };
    }
    const dataUri = `data:${media.mimeType};base64,${media.data.toString('base64')}`;
    return {
      textRepresentation: `[Image received: ${media.filename}, ${(media.data.length / 1024).toFixed(0)} KB. The image has been encoded and is available as a data URI for vision-capable models.]`,
      dataUri,
    };
  }

  /**
   * Detect media type from MIME type string.
   */
  static detectType(mimeType: string): MediaType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'file';
  }
}

/** Singleton instance */
export const mediaHandler = new MediaHandler();
