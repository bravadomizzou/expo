/* eslint-env browser */
import invariant from 'invariant';
import { CameraType, ImageType } from './CameraModule.types';
import * as Utils from './CameraUtils';
import * as CapabilityUtils from './CapabilityUtils';
import { isBackCameraAvailableAsync, isFrontCameraAvailableAsync, canGetUserMedia, } from './UserMediaManager';
import { FacingModeToCameraType, PictureSizes } from './constants';
export { ImageType, CameraType };
const VALID_SETTINGS_KEYS = [
    'autoFocus',
    'flashMode',
    'exposureCompensation',
    'colorTemperature',
    'iso',
    'brightness',
    'contrast',
    'saturation',
    'sharpness',
    'focusDistance',
    'whiteBalance',
    'zoom',
];
class CameraModule {
    constructor(videoElement) {
        this.videoElement = videoElement;
        this.onCameraReady = () => { };
        this.onMountError = () => { };
        this.stream = null;
        this.settings = null;
        this.isStartingCamera = false;
        this.cameraType = CameraType.front;
        this.webCameraSettings = {
            autoFocus: 'continuous',
            flashMode: 'off',
            whiteBalance: 'continuous',
            zoom: 1,
        };
        // TODO: Bacon: we don't even use ratio in native...
        this.getAvailablePictureSizes = async (ratio) => {
            return PictureSizes;
        };
        if (this.videoElement) {
            this.videoElement.addEventListener('loadedmetadata', () => {
                this.syncTrackCapabilities();
            });
        }
    }
    get type() {
        return this.cameraType;
    }
    async updateWebCameraSettingsAsync(nextSettings) {
        const changes = {};
        for (const key of Object.keys(nextSettings)) {
            if (!VALID_SETTINGS_KEYS.includes(key))
                continue;
            const nextValue = nextSettings[key];
            if (nextValue !== this.webCameraSettings[key]) {
                changes[key] = nextValue;
            }
        }
        // Only update the native camera if changes were found
        const hasChanges = !!Object.keys(changes).length;
        this.webCameraSettings = { ...this.webCameraSettings, ...changes };
        if (hasChanges) {
            await this.syncTrackCapabilities(changes);
        }
        return hasChanges;
    }
    async setTypeAsync(value) {
        if (value === this.cameraType) {
            return;
        }
        this.cameraType = value;
        await this.resumePreview();
    }
    setPictureSize(value) {
        if (value === this.pictureSize) {
            return;
        }
        invariant(PictureSizes.includes(value), `expo-camera: CameraModule.setPictureSize(): invalid size supplied ${value}, expected one of: ${PictureSizes.join(', ')}`);
        // TODO: Bacon: IMP
        // const [width, height] = value.split('x');
        // const aspectRatio = parseFloat(width) / parseFloat(height);
        this.pictureSize = value;
    }
    isTorchAvailable() {
        return isCapabilityAvailable(this.videoElement, 'torch');
    }
    isZoomAvailable() {
        return isCapabilityAvailable(this.videoElement, 'zoom');
    }
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
    async onCapabilitiesReady(track, settings = {}) {
        const capabilities = track.getCapabilities();
        // Create an empty object because if you set a constraint that isn't available an error will be thrown.
        const constraints = {};
        // TODO: Bacon: Add `pointsOfInterest` support
        const clampedValues = [
            'exposureCompensation',
            'colorTemperature',
            'iso',
            'brightness',
            'contrast',
            'saturation',
            'sharpness',
            'focusDistance',
            'zoom',
        ];
        for (const property of clampedValues) {
            if (capabilities[property]) {
                constraints[property] = convertNormalizedSetting(capabilities[property], settings[property]);
            }
        }
        const _validatedConstrainedValue = (key, propName, converter) => validatedConstrainedValue(key, propName, converter(settings[propName]), capabilities, settings, this.cameraType);
        if (capabilities.focusMode && settings.autoFocus !== undefined) {
            constraints.focusMode = _validatedConstrainedValue('focusMode', 'autoFocus', CapabilityUtils.convertAutoFocusJSONToNative);
        }
        if (capabilities.torch && settings.flashMode !== undefined) {
            constraints.torch = _validatedConstrainedValue('torch', 'flashMode', CapabilityUtils.convertFlashModeJSONToNative);
        }
        if (capabilities.whiteBalanceMode && settings.whiteBalance !== undefined) {
            constraints.whiteBalanceMode = _validatedConstrainedValue('whiteBalanceMode', 'whiteBalance', CapabilityUtils.convertWhiteBalanceJSONToNative);
        }
        await track.applyConstraints({ advanced: [constraints] });
    }
    async applyVideoConstraints(constraints) {
        if (!this.stream || !this.stream.getVideoTracks) {
            return false;
        }
        return await applyConstraints(this.stream.getVideoTracks(), constraints);
    }
    async applyAudioConstraints(constraints) {
        if (!this.stream || !this.stream.getAudioTracks) {
            return false;
        }
        return await applyConstraints(this.stream.getAudioTracks(), constraints);
    }
    async syncTrackCapabilities(settings = {}) {
        if (this.stream && this.stream.getVideoTracks) {
            await Promise.all(this.stream.getVideoTracks().map(track => this.onCapabilitiesReady(track, settings)));
        }
    }
    setStream(stream) {
        this.stream = stream;
        this.settings = stream ? stream.getTracks()[0].getSettings() : null;
        setVideoSource(this.videoElement, stream);
    }
    getActualCameraType() {
        if (this.settings) {
            // On desktop no value will be returned, in this case we should assume the cameraType is 'front'
            const { facingMode = 'user' } = this.settings;
            return FacingModeToCameraType[facingMode];
        }
        return null;
    }
    async ensureCameraIsRunningAsync() {
        if (!this.stream) {
            await this.resumePreview();
        }
    }
    async resumePreview() {
        if (this.isStartingCamera) {
            return null;
        }
        this.isStartingCamera = true;
        try {
            this.stopAsync();
            const stream = await Utils.getStreamDevice(this.type);
            this.setStream(stream);
            this.isStartingCamera = false;
            this.onCameraReady();
            return stream;
        }
        catch (error) {
            this.isStartingCamera = false;
            this.onMountError({ nativeEvent: error });
        }
        return null;
    }
    takePicture(config) {
        const base64 = Utils.captureImage(this.videoElement, config);
        const capturedPicture = {
            uri: base64,
            base64,
            width: 0,
            height: 0,
        };
        if (this.settings) {
            const { width = 0, height = 0 } = this.settings;
            capturedPicture.width = width;
            capturedPicture.height = height;
            // TODO: Bacon: verify/enforce exif shape.
            capturedPicture.exif = this.settings;
        }
        if (config.onPictureSaved) {
            config.onPictureSaved({ nativeEvent: { data: capturedPicture, id: config.id } });
        }
        return capturedPicture;
    }
    stopAsync() {
        stopMediaStream(this.stream);
        this.setStream(null);
    }
    static async getAvailableCameraTypesAsync() {
        if (!canGetUserMedia() || !navigator.mediaDevices.enumerateDevices)
            return [];
        const devices = await navigator.mediaDevices.enumerateDevices();
        const types = await Promise.all([
            (await isFrontCameraAvailableAsync(devices)) && CameraType.front,
            (await isBackCameraAvailableAsync()) && CameraType.back,
        ]);
        return types.filter(Boolean);
    }
}
function stopMediaStream(stream) {
    if (!stream)
        return;
    if (stream.getAudioTracks)
        stream.getAudioTracks().forEach(track => track.stop());
    if (stream.getVideoTracks)
        stream.getVideoTracks().forEach(track => track.stop());
    if (isMediaStreamTrack(stream))
        stream.stop();
}
function setVideoSource(video, stream) {
    try {
        video.srcObject = stream;
    }
    catch (_) {
        if (stream) {
            video.src = window.URL.createObjectURL(stream);
        }
        else if (typeof video.src === 'string') {
            window.URL.revokeObjectURL(video.src);
        }
    }
}
async function applyConstraints(tracks, constraints) {
    try {
        await Promise.all(tracks.map(async (track) => {
            await track.applyConstraints({ advanced: [constraints] });
        }));
        return true;
    }
    catch (_) {
        return false;
    }
}
function isCapabilityAvailable(video, keyName) {
    const stream = video.srcObject;
    if (stream instanceof MediaStream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (typeof videoTrack.getCapabilities === 'undefined') {
            return false;
        }
        const capabilities = videoTrack.getCapabilities();
        return !!capabilities[keyName];
    }
    return false;
}
function isMediaStreamTrack(input) {
    return typeof input.stop === 'function';
}
function convertNormalizedSetting(range, value) {
    if (!value)
        return;
    // convert the normalized incoming setting to the native camera zoom range
    const converted = convertRange(value, [range.min, range.max]);
    // clamp value so we don't get an error
    return Math.min(range.max, Math.max(range.min, converted));
}
function convertRange(value, r2, r1 = [0, 1]) {
    return ((value - r1[0]) * (r2[1] - r2[0])) / (r1[1] - r1[0]) + r2[0];
}
function validatedConstrainedValue(constraintKey, settingsKey, convertedSetting, capabilities, settings, cameraType) {
    const setting = settings[settingsKey];
    if (Array.isArray(capabilities[constraintKey]) &&
        convertedSetting &&
        !capabilities[constraintKey].includes(convertedSetting)) {
        console.warn(` { ${settingsKey}: "${setting}" } (converted to "${convertedSetting}" in the browser) is not supported for camera type "${cameraType}" in your browser. Using the default value instead.`);
        return undefined;
    }
    return convertedSetting;
}
export default CameraModule;
//# sourceMappingURL=CameraModule.js.map