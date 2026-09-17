// Cloudinary rejects files over 10MB on the current plan
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EDGE_PX = 2560;

const CLOUDINARY_CLOUD_NAME = 'rbpepl7c';
const CLOUDINARY_UPLOAD_PRESET = 'website';
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/** Posts one file to Cloudinary's unsigned upload endpoint and returns its secure URL. */
const postToCloudinary = async (
    file: Blob,
    filename: string,
    extra: { folder?: string; tags?: string[] } = {}
): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file, filename);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    if (extra.folder) formData.append('folder', extra.folder);
    if (extra.tags?.length) formData.append('tags', extra.tags.join(','));

    const response = await fetch(CLOUDINARY_UPLOAD_URL, { method: 'POST', body: formData });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Cloudinary error:', errorData);
        throw new Error(errorData.error?.message || 'Upload failed');
    }
    const data = await response.json();
    return data.secure_url as string;
};

/**
 * Server-side upload of an in-memory image (e.g. a diagram cut out of a PDF
 * during parsing). Uses the same unsigned preset as the browser helpers
 * below; nothing here touches the DOM, so it is safe in API routes.
 */
export const uploadImageBuffer = async (
    buffer: Buffer,
    opts: { filename: string; contentType: string; folder?: string; tags?: string[] }
): Promise<string> => {
    if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new Error(`Image ${opts.filename} is ${buffer.length} bytes, over the ${MAX_UPLOAD_BYTES} byte limit`);
    }
    const blob = new Blob([new Uint8Array(buffer)], { type: opts.contentType });
    return postToCloudinary(blob, opts.filename, { folder: opts.folder, tags: opts.tags });
};

// Downscale/re-encode an image in the browser until it fits under the upload limit
const compressImage = async (file: File): Promise<Blob> => {
    if (!file.type.startsWith('image/') || file.size <= MAX_UPLOAD_BYTES) return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const toBlob = (type: string, quality: number) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

    let result: Blob = file;
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
        // Prefer WebP (keeps transparency); Safari falls back to JPEG
        let blob = await toBlob('image/webp', quality);
        if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', quality);
        if (!blob) break;
        result = blob;
        if (blob.size <= MAX_UPLOAD_BYTES) break;
    }
    return result;
};

// Upload single or multiple images to Cloudinary
export const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setImages: React.Dispatch<React.SetStateAction<string[]>> | ((urls: string[]) => void),
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
): Promise<string[]> => {
    if (!e.target.files?.length) return [];

    setIsLoading(true);

    try {
        const uploadPromises = Array.from(e.target.files).map(async (file) => {
            const upload = await compressImage(file);

            try {
                const url = await postToCloudinary(upload, file.name);
                console.log('Image uploaded successfully:', url);
                return url;
            } catch (error) {
                console.error('Upload failed for file:', file.name, error);
                return null;
            }
        });

        const urls = (await Promise.all(uploadPromises)).filter(Boolean) as string[];

        if (urls.length === 0) {
            throw new Error('No images were uploaded successfully');
        }

        // Call the setImages callback with the new URLs
        setImages(urls);

        setIsLoading(false);
        return urls;
    } catch (error) {
        console.error('Image upload error:', error);
        setIsLoading(false);
        throw error;
    }
};

// Upload a single image (helper function for edit modal)
export const handleSingleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    onSuccess: (url: string) => void,
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
): Promise<string | null> => {
    if (!e.target.files?.length) return null;

    setIsLoading(true);

    try {
        const file = e.target.files[0];
        const upload = await compressImage(file);
        const url = await postToCloudinary(upload, file.name);

        console.log('Image uploaded successfully:', url);
        onSuccess(url);

        setIsLoading(false);
        return url;
    } catch (error) {
        console.error('Image upload error:', error);
        alert('Failed to upload image. Please try again.');
        setIsLoading(false);
        return null;
    }
};

export const removeImage = (
    index: number,
    setImages: React.Dispatch<React.SetStateAction<string[]>>
) => {
    setImages((prevImages) => prevImages.filter((_, i) => i !== index));
};
