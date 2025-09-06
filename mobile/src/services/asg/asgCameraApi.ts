/**
 * ASG Camera Server API Client
 * Provides methods to interact with the AsgCameraServer Java APIs
 */

import {PhotoInfo, GalleryResponse, ServerStatus, HealthResponse} from "../../types/asg"
import RNFS from "react-native-fs"
import {localStorageService} from "./localStorageService"

export class AsgCameraApiClient {
  private baseUrl: string
  private port: number
  private lastRequestTime: number = 0
  private requestQueue: Array<() => Promise<any>> = []
  private isProcessingQueue: boolean = false

  constructor(serverUrl?: string, port: number = 8089) {
    this.port = port
    this.baseUrl = serverUrl || `http://localhost:${port}`
    console.log(`[ASG Camera API] Client initialized with server: ${this.baseUrl}`)
  }

  /**
   * Set the server URL and port
   */
  setServer(serverUrl: string, port?: number) {
    console.log(`[ASG Camera API] setServer called with serverUrl: ${serverUrl}, port: ${port}`)
    const newPort = port || this.port
    const newUrl = `http://${serverUrl.replace(/^https?:\/\//, "")}:${newPort}`

    console.log(`[ASG Camera API] Constructed newUrl: ${newUrl}`)
    console.log(`[ASG Camera API] Current baseUrl: ${this.baseUrl}`)

    // Only update if the URL actually changed
    if (this.baseUrl !== newUrl) {
      const oldUrl = this.baseUrl
      this.baseUrl = newUrl
      this.port = newPort
      console.log(`[ASG Camera API] Server changed from ${oldUrl} to ${this.baseUrl}`)
    } else {
      console.log(`[ASG Camera API] Server URL unchanged: ${this.baseUrl}`)
    }
  }

  /**
   * Get the current server URL
   */
  getServerUrl(): string {
    return this.baseUrl
  }

  /**
   * Rate limiting helper - ensures minimum delay between requests
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    const minDelay = 500 // 500ms minimum delay between requests

    if (timeSinceLastRequest < minDelay) {
      const delay = minDelay - timeSinceLastRequest
      console.log(`[ASG Camera API] Rate limiting: waiting ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    this.lastRequestTime = Date.now()
  }

  /**
   * Make a request to the ASG Camera Server with rate limiting and retry logic
   */
  private async makeRequest<T>(endpoint: string, options?: RequestInit, retries: number = 2): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const method = options?.method || "GET"

    console.log(`[ASG Camera API] makeRequest called with endpoint: ${endpoint}`)
    console.log(`[ASG Camera API] Current baseUrl: ${this.baseUrl}`)
    console.log(`[ASG Camera API] Full URL: ${url}`)
    console.log(`[ASG Camera API] Method: ${method}`)
    console.log(`[ASG Camera API] Retries remaining: ${retries}`)
    console.log(`[ASG Camera API] Request options:`, {
      method,
      headers: options?.headers,
      body: options?.body ? "Present" : "None",
    })

    const startTime = Date.now()

    try {
      // Apply rate limiting only for non-GET requests
      if (method !== "GET") {
        await this.rateLimit()
      }

      // Prepare headers - don't set Content-Type for GET requests
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "User-Agent": "MentraOS-Mobile/1.0",
      }
      if (method !== "GET") {
        headers["Content-Type"] = "application/json"
      }
      if (options?.headers) {
        Object.assign(headers, options.headers)
      }

      console.log(`[ASG Camera API] Making fetch request to: ${url}`)
      console.log(`[ASG Camera API] Headers being sent:`, headers)

      const response = await fetch(url, {
        headers,
        ...options,
      })

      const duration = Date.now() - startTime
      console.log(`[ASG Camera API] Response received in ${duration}ms:`, {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        url: response.url,
      })

      if (!response.ok) {
        console.error(`[ASG Camera API] HTTP Error ${response.status}: ${response.statusText}`)

        // Handle rate limiting with retry
        if (response.status === 429 && retries > 0) {
          const retryDelay = Math.pow(2, 3 - retries) * 1000 // Exponential backoff: 1s, 2s
          console.log(`[ASG Camera API] Rate limited, retrying in ${retryDelay}ms (${retries} retries left)`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return this.makeRequest<T>(endpoint, options, retries - 1)
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Handle different response types
      const contentType = response.headers.get("content-type")
      console.log(`[ASG Camera API] Response content-type: ${contentType}`)

      if (contentType?.includes("application/json")) {
        const data = await response.json()
        console.log(`[ASG Camera API] JSON Response received:`, data)
        return data
      } else if (contentType?.includes("image/") || contentType?.includes("application/octet-stream")) {
        // For image responses and binary data (including AVIF), return the blob
        const blob = await response.blob()
        console.log(`[ASG Camera API] Binary/Image Response received:`, {
          size: blob.size,
          type: blob.type,
        })

        // Quick check if this might be an AVIF file
        if (contentType?.includes("application/octet-stream") && blob.size > 12) {
          const arrayBuffer = await blob.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer.slice(4, 12))
          const ftypSignature = String.fromCharCode(...bytes)
          if (ftypSignature === "ftypavif") {
            console.log(`[ASG Camera API] Detected AVIF file in response`)
          }
          // Return a new blob since we consumed the original
          return new Blob([arrayBuffer], {type: blob.type}) as T
        }

        return blob as T
      } else {
        // For text responses
        const text = await response.text()
        console.log(
          `[ASG Camera API] Text Response received:`,
          text.substring(0, 200) + (text.length > 200 ? "..." : ""),
        )
        return text as T
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`[ASG Camera API] Error (${endpoint}) after ${duration}ms:`, error)
      console.error(`[ASG Camera API] Error details:`, {
        endpoint,
        url,
        method,
        duration,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  /**
   * Take a picture using the ASG camera
   */
  async takePicture(): Promise<{message: string}> {
    console.log(`[ASG Camera API] Taking picture...`)
    return this.makeRequest<{message: string}>("/api/take-picture", {
      method: "POST",
    })
  }

  /**
   * Get the latest photo as a blob
   */
  async getLatestPhoto(): Promise<Blob> {
    console.log(`[ASG Camera API] Getting latest photo...`)
    return this.makeRequest<Blob>("/api/latest-photo")
  }

  /**
   * Get the latest photo as a data URL
   */
  async getLatestPhotoAsDataUrl(): Promise<string> {
    console.log(`[ASG Camera API] Getting latest photo as data URL...`)
    const blob = await this.getLatestPhoto()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  /**
   * Get gallery photos from the server with optional pagination
   */
  async getGallery(limit?: number, offset?: number): Promise<GalleryResponse> {
    console.log(`[ASG Camera API] getGallery called with limit=${limit}, offset=${offset}`)
    console.log(`[ASG Camera API] Current baseUrl: ${this.baseUrl}`)

    // Build URL with optional query parameters
    let galleryUrl = `${this.baseUrl}/api/gallery`
    const params = new URLSearchParams()
    if (limit !== undefined) params.append("limit", limit.toString())
    if (offset !== undefined) params.append("offset", offset.toString())
    if (params.toString()) galleryUrl += `?${params.toString()}`

    console.log(`[ASG Camera API] Full gallery URL: ${galleryUrl}`)

    // Use browser-like headers since we know the browser works
    try {
      console.log(`[ASG Camera API] Making direct fetch to gallery endpoint`)
      const response = await fetch(galleryUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "MentraOS-Mobile/1.0",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })

      console.log(`[ASG Camera API] Response status: ${response.status}`)

      if (!response.ok) {
        throw new Error(`Gallery endpoint returned: ${response.status}`)
      }

      const responseText = await response.text()
      console.log(`[ASG Camera API] Raw response:`, responseText.substring(0, 1000))

      let data: any
      try {
        data = JSON.parse(responseText)
      } catch (parseError) {
        console.log(`[ASG Camera API] Failed to parse JSON:`, parseError)
        throw new Error("Invalid JSON response from gallery endpoint")
      }

      // Handle the exact response format we see from browser
      if (data && data.status === "success" && data.data?.photos) {
        console.log(`[ASG Camera API] Found ${data.data.photos.length} photos (total: ${data.data.total_count})`)

        // Map photos to ensure proper URL construction
        const photos = data.data.photos.map((photo: any) => ({
          ...photo,
          url: this.constructPhotoUrl(photo.url || photo.name),
          download: this.constructDownloadUrl(photo.download || photo.name),
        }))

        return {
          status: "success",
          data: {
            photos,
            total_count: data.data.total_count,
            returned_count: data.data.returned_count,
            has_more: data.data.has_more,
            offset: data.data.offset,
            limit: data.data.limit,
          },
        }
      } else {
        console.log(`[ASG Camera API] Invalid response structure:`, data)
        throw new Error("Invalid response structure from gallery endpoint")
      }
    } catch (error) {
      console.log(`[ASG Camera API] Gallery request failed:`, error)
      throw error
    }
  }

  async deleteGalleryPhoto(photoId: string): Promise<any> {
    const response = await this.makeRequest<any>(`/api/gallery/${photoId}`, {
      method: "DELETE",
    })
    console.log("Photo deleted successfully:", photoId)
    return response
  }

  /**
   * Get the gallery photos array with proper URL construction
   */
  async getGalleryPhotos(
    limit?: number,
    offset?: number,
  ): Promise<{
    photos: PhotoInfo[]
    hasMore: boolean
    totalCount: number
  }> {
    console.log(`[ASG Camera API] Getting gallery photos with limit=${limit}, offset=${offset}...`)
    try {
      const response = await this.getGallery(limit, offset)
      console.log(`[ASG Camera API] Gallery response:`, response)

      if (!response.data || !response.data.photos) {
        console.warn(`[ASG Camera API] Invalid gallery response structure:`, response)
        return {photos: [], hasMore: false, totalCount: 0}
      }

      const photos = response.data.photos
      console.log(`[ASG Camera API] Found ${photos.length} photos (total: ${response.data.total_count})`)

      // Ensure each photo has proper URLs and detect AVIF files
      const processedPhotos = photos.map(photo => {
        // Check if filename suggests AVIF (no extension or .avif)
        const mightBeAvif = !photo.name.includes(".") || photo.name.match(/\.(avif|avifs)$/i)

        return {
          ...photo,
          url: this.constructPhotoUrl(photo.name),
          download: this.constructDownloadUrl(photo.name),
          mime_type: photo.mime_type || (mightBeAvif ? "image/avif" : undefined),
        }
      })

      console.log(`[ASG Camera API] Processed photos:`, processedPhotos)
      return {
        photos: processedPhotos,
        hasMore: response.data.has_more || false,
        totalCount: response.data.total_count || photos.length,
      }
    } catch (error) {
      console.error(`[ASG Camera API] Error getting gallery photos:`, error)
      throw error
    }
  }

  /**
   * Discover available endpoints on the server
   */
  async discoverEndpoints(): Promise<string[]> {
    const availableEndpoints: string[] = []
    const testEndpoints = [
      "/",
      "/api",
      "/api/health",
      "/api/status",
      "/api/gallery",
      "/gallery",
      "/api/photos",
      "/photos",
      "/api/images",
      "/images",
      "/api/take-picture",
      "/api/latest-photo",
    ]

    console.log(`[ASG Camera API] Discovering available endpoints...`)

    for (const endpoint of testEndpoints) {
      try {
        console.log(`[ASG Camera API] Testing endpoint: ${endpoint}`)
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "HEAD",
          headers: {
            "Accept": "*/*",
            "User-Agent": "MentraOS-Mobile/1.0",
          },
          signal: AbortSignal.timeout(5000),
        })

        if (response.ok) {
          availableEndpoints.push(endpoint)
          console.log(`[ASG Camera API] Found endpoint: ${endpoint} (${response.status})`)
        } else {
          console.log(`[ASG Camera API] Endpoint ${endpoint} returned: ${response.status}`)
        }
      } catch (error) {
        console.log(`[ASG Camera API] Endpoint ${endpoint} failed:`, error)
        // For /api/gallery specifically, let's try a GET request to see if it's a HEAD request issue
        if (endpoint === "/api/gallery") {
          try {
            console.log(`[ASG Camera API] Trying GET request for /api/gallery...`)
            const getResponse = await fetch(`${this.baseUrl}${endpoint}`, {
              method: "GET",
              headers: {
                "Accept": "application/json",
                "User-Agent": "MentraOS-Mobile/1.0",
              },
              signal: AbortSignal.timeout(5000),
            })
            console.log(`[ASG Camera API] GET /api/gallery status: ${getResponse.status}`)
            if (getResponse.ok) {
              console.log(`[ASG Camera API] GET /api/gallery works! Adding to available endpoints`)
              availableEndpoints.push(endpoint)
            }
          } catch (getError) {
            console.log(`[ASG Camera API] GET /api/gallery also failed:`, getError)
          }
        }
      }
    }

    console.log(`[ASG Camera API] Available endpoints:`, availableEndpoints)
    return availableEndpoints
  }

  /**
   * Construct a photo URL for a given filename
   */
  private constructPhotoUrl(filename: string): string {
    return `${this.baseUrl}/api/photo?file=${encodeURIComponent(filename)}`
  }

  /**
   * Construct a download URL for a given filename
   */
  private constructDownloadUrl(filename: string): string {
    return `${this.baseUrl}/api/download?file=${encodeURIComponent(filename)}`
  }

  /**
   * Get a specific photo by filename
   */
  async getPhoto(filename: string): Promise<Blob> {
    console.log(`[ASG Camera API] Getting photo: ${filename}`)
    return this.makeRequest<Blob>(`/api/photo?file=${encodeURIComponent(filename)}`)
  }

  /**
   * Get a specific photo as a data URL
   */
  async getPhotoAsDataUrl(filename: string): Promise<string> {
    console.log(`[ASG Camera API] Getting photo as data URL: ${filename}`)
    const blob = await this.getPhoto(filename)
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  /**
   * Download a photo (returns download URL)
   */
  async downloadPhoto(filename: string): Promise<string> {
    console.log(`[ASG Camera API] Downloading photo: ${filename}`)
    const downloadUrl = `${this.baseUrl}/api/download?file=${encodeURIComponent(filename)}`
    console.log(`[ASG Camera API] Download URL: ${downloadUrl}`)
    return downloadUrl
  }

  /**
   * Get server status information
   */
  async getStatus(): Promise<ServerStatus> {
    console.log(`[ASG Camera API] Getting server status...`)
    return this.makeRequest<ServerStatus>("/api/status")
  }

  /**
   * Get server health check
   */
  async getHealth(): Promise<HealthResponse> {
    console.log(`[ASG Camera API] Getting server health...`)
    return this.makeRequest<HealthResponse>("/api/health")
  }

  /**
   * Get the index page (for testing)
   */
  async getIndexPage(): Promise<string> {
    console.log(`[ASG Camera API] Getting index page...`)
    return this.makeRequest<string>("/")
  }

  /**
   * Check if the server is reachable (simple ping)
   */
  async isServerReachable(): Promise<boolean> {
    try {
      console.log(`[ASG Camera API] Checking server reachability...`)
      // Use a simple HEAD request to check reachability
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000) // 3 second timeout

      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: "HEAD",
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      console.log(`[ASG Camera API] Server is reachable`)
      return response.ok
    } catch (error) {
      console.log(`[ASG Camera API] Server is not reachable:`, error)
      return false
    }
  }

  /**
   * Get comprehensive server information
   */
  async getServerInfo(): Promise<{
    reachable: boolean
    status?: ServerStatus
    health?: HealthResponse
    error?: string
  }> {
    try {
      const [status, health] = await Promise.all([this.getStatus(), this.getHealth()])

      return {
        reachable: true,
        status,
        health,
      }
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  /**
   * Sync with server to get changed files since last sync
   */
  async syncWithServer(
    clientId: string,
    lastSyncTime?: number,
    includeThumbnails: boolean = false,
  ): Promise<{
    status: string
    data: {
      client_id: string
      changed_files: PhotoInfo[]
      deleted_files: string[]
      server_time: number
      total_changed: number
      total_size: number
    }
  }> {
    const params = new URLSearchParams({
      client_id: clientId,
      include_thumbnails: includeThumbnails.toString(),
    })

    if (lastSyncTime) {
      params.append("last_sync_time", lastSyncTime.toString())
    }

    const response = await this.makeRequest(`/api/sync?${params.toString()}`, {
      method: "GET",
    })

    return response
  }

  /**
   * Batch sync files from server with controlled concurrency
   */
  async batchSyncFiles(
    files: PhotoInfo[],
    includeThumbnails: boolean = false,
    onProgress?: (current: number, total: number, fileName: string, fileProgress?: number) => void,
  ): Promise<{
    downloaded: PhotoInfo[]
    failed: string[]
    total_size: number
  }> {
    const results = {
      downloaded: [] as PhotoInfo[],
      failed: [] as string[],
      total_size: 0,
    }

    // Process files sequentially to avoid overwhelming the network
    // This is more reliable, especially on slower connections
    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      // Report progress if callback provided - start of this file (0%)
      if (onProgress) {
        onProgress(i + 1, files.length, file.name, 0)
      }

      try {
        console.log(`[ASG Camera API] Downloading file ${i + 1}/${files.length}: ${file.name}`)

        // Pass a progress callback to downloadFile
        const fileData = await this.downloadFile(file.name, includeThumbnails, fileProgress => {
          if (onProgress) {
            onProgress(i + 1, files.length, file.name, fileProgress)
          }
        })
        results.total_size += file.size

        // Combine file info with downloaded file paths
        const downloadedFile = {
          ...file,
          filePath: fileData.filePath,
          thumbnailPath: fileData.thumbnailPath,
          mime_type: fileData.mime_type || file.mime_type,
        }

        results.downloaded.push(downloadedFile)
        console.log(`[ASG Camera API] Successfully downloaded: ${file.name}`)

        // Small delay between downloads to avoid overwhelming the server
        // Shorter delay than before since we're already sequential
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      } catch (error) {
        console.error(`[ASG Camera API] Failed to download ${file.name}:`, error)
        results.failed.push(file.name)
      }
    }

    return results
  }

  /**
   * Delete files from server after successful sync
   */
  async deleteFilesFromServer(fileNames: string[]): Promise<{
    deleted: string[]
    failed: string[]
  }> {
    if (fileNames.length === 0) {
      return {deleted: [], failed: []}
    }

    try {
      const response = await this.makeRequest("/api/delete-files", {
        method: "POST",
        body: JSON.stringify({files: fileNames}),
      })

      // Parse the response format from the ASG server
      if (response.data && response.data.results) {
        const deleted: string[] = []
        const failed: string[] = []

        for (const result of response.data.results) {
          if (result.success) {
            deleted.push(result.file)
          } else {
            failed.push(result.file)
          }
        }

        console.log(`[ASG Camera API] Delete results: ${deleted.length} deleted, ${failed.length} failed`)
        return {deleted, failed}
      }

      return response
    } catch (error) {
      console.error("Failed to delete files from server:", error)
      return {deleted: [], failed: fileNames}
    }
  }

  /**
   * Get sync status from server
   */
  async getSyncStatus(): Promise<{
    total_files: number
    total_size: number
    last_modified: number
  }> {
    const response = await this.makeRequest("/sync/status", {
      method: "GET",
    })

    return response
  }

  /**
   * Download a file from the server and save to filesystem
   */
  async downloadFile(
    filename: string,
    includeThumbnail: boolean = false,
    onProgress?: (progress: number) => void,
  ): Promise<{
    filePath: string
    thumbnailPath?: string
    mime_type: string
  }> {
    console.log(`[ASG Camera API] Downloading file: ${filename}`)

    try {
      // Get the local file path where we'll save this
      const localFilePath = localStorageService.getPhotoFilePath(filename)
      const localThumbnailPath = includeThumbnail ? localStorageService.getThumbnailFilePath(filename) : undefined

      // Determine if this is a video file based on extension
      const isVideo = filename.match(/\.(mp4|mov|avi|webm|mkv)$/i)

      // Use /api/download for videos (full file) and /api/photo for images
      const downloadEndpoint = isVideo ? "download" : "photo"
      const downloadUrl = `${this.baseUrl}/api/${downloadEndpoint}?file=${encodeURIComponent(filename)}`

      // Download the file directly to filesystem
      console.log(`[ASG Camera API] Downloading ${isVideo ? "video" : "photo"} from: ${downloadUrl}`)
      console.log(`[ASG Camera API] Saving to: ${localFilePath}`)

      const downloadResult = await RNFS.downloadFile({
        fromUrl: downloadUrl,
        toFile: localFilePath,
        headers: {
          "Accept": "*/*",
          "User-Agent": "MentraOS-Mobile/1.0",
        },
        progressDivider: 10,
        begin: res => {
          console.log(`[ASG Camera API] Download started for ${filename}, size: ${res.contentLength}`)
        },
        progress: res => {
          const percentage = Math.round((res.bytesWritten / res.contentLength) * 100)

          // Call the progress callback if provided
          if (onProgress) {
            onProgress(percentage)
          }

          if (percentage % 20 === 0) {
            // Log every 20%
            console.log(`[ASG Camera API] Download progress ${filename}: ${percentage}%`)
          }
        },
      }).promise

      if (downloadResult.statusCode !== 200) {
        throw new Error(`Failed to download ${filename}: HTTP ${downloadResult.statusCode}`)
      }

      console.log(`[ASG Camera API] Successfully downloaded ${filename} to filesystem`)

      // Detect MIME type by checking file signature
      let mimeType = "application/octet-stream"
      try {
        // Read first 20 bytes to check file signature
        const firstBytes = await RNFS.read(localFilePath, 20, 0, "base64")
        const decodedBytes = atob(firstBytes)

        // Check for AVIF signature
        if (decodedBytes.length > 11) {
          const ftypSignature = decodedBytes.substring(4, 12)
          if (ftypSignature === "ftypavif") {
            mimeType = "image/avif"
            console.log(`[ASG Camera API] Detected AVIF file: ${filename}`)
          } else if (decodedBytes.substring(0, 2) === "\xFF\xD8") {
            mimeType = "image/jpeg"
          } else if (decodedBytes.substring(0, 8) === "\x89PNG\r\n\x1a\n") {
            mimeType = "image/png"
          }
        }

        // Also check by extension
        if (mimeType === "application/octet-stream") {
          if (filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg")) {
            mimeType = "image/jpeg"
          } else if (filename.toLowerCase().endsWith(".png")) {
            mimeType = "image/png"
          } else if (filename.toLowerCase().endsWith(".mp4")) {
            mimeType = "video/mp4"
          } else if (!filename.includes(".")) {
            // Files without extension are likely AVIF
            mimeType = "image/avif"
          }
        }
      } catch (e) {
        console.warn(`[ASG Camera API] Could not detect MIME type for ${filename}:`, e)
      }

      // Download thumbnail if requested and it's a video
      let thumbnailPath: string | undefined
      if (includeThumbnail && filename.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm)$/)) {
        try {
          console.log(`[ASG Camera API] Downloading thumbnail for ${filename}`)
          console.log(`[ASG Camera API] Using /api/photo endpoint for video thumbnail`)

          // The server's /api/photo endpoint serves thumbnails for video files
          // It detects video files and automatically generates/serves thumbnails instead of the full video
          const thumbResult = await RNFS.downloadFile({
            fromUrl: `${this.baseUrl}/api/photo?file=${encodeURIComponent(filename)}`,
            toFile: localThumbnailPath!,
            headers: {
              "Accept": "image/*",
              "User-Agent": "MentraOS-Mobile/1.0",
            },
            begin: res => {
              console.log(`[ASG Camera API] Thumbnail download started for ${filename}, size: ${res.contentLength}`)
            },
            progress: res => {
              const percentage = Math.round((res.bytesWritten / res.contentLength) * 100)
              if (percentage % 25 === 0) {
                console.log(`[ASG Camera API] Thumbnail download progress ${filename}: ${percentage}%`)
              }
            },
          }).promise

          console.log(
            `[ASG Camera API] Thumbnail download result for ${filename}: status=${thumbResult.statusCode}, bytesWritten=${thumbResult.bytesWritten}`,
          )

          if (thumbResult.statusCode === 200) {
            thumbnailPath = localThumbnailPath
            console.log(`[ASG Camera API] Successfully downloaded thumbnail to: ${thumbnailPath}`)

            // Verify the file exists
            const exists = await RNFS.exists(thumbnailPath)
            console.log(`[ASG Camera API] Thumbnail file exists: ${exists}`)
          } else {
            console.warn(`[ASG Camera API] Thumbnail download failed with status: ${thumbResult.statusCode}`)
          }
        } catch (error) {
          console.warn(`[ASG Camera API] Failed to download thumbnail for ${filename}:`, error)
        }
      } else {
        console.log(
          `[ASG Camera API] Skipping thumbnail download - includeThumbnail: ${includeThumbnail}, filename: ${filename}, is video extension: ${filename.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm)$/) ? "yes" : "no"}`,
        )
      }

      return {
        filePath: localFilePath,
        thumbnailPath: thumbnailPath,
        mime_type: mimeType,
      }
    } catch (error) {
      console.error(`[ASG Camera API] Error downloading file ${filename}:`, error)
      throw error
    }
  }
}

// Export a default instance - will be initialized with proper IP when used
export const asgCameraApi = new AsgCameraApiClient()
