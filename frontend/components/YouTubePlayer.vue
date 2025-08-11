<!-- components/YouTubePlayer.vue -->
<template>
    <div class="yt-player">
        <div class="video-wrap relative bg-black rounded overflow-hidden">
            <video ref="videoEl" :src="videoSrc" crossOrigin="anonymous" class="w-full max-h-[60vh] bg-black"
                @timeupdate="onTimeUpdate" @loadedmetadata="onLoadedMeta" @error="onVideoError" playsinline>
                <track v-for="(t, i) in subtitles" :key="t.vttUrl + i" :src="t.vttUrl" kind="subtitles"
                    :label="t.language" :srclang="t.language" :default="i === activeSubtitle" />
            </video>

            <!-- overlay controls -->
            <div class="controls absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                <input aria-label="seek" type="range" class="w-full h-1 accent-red-600" :min="0" :max="duration || 0"
                    step="0.1" v-model.number="seekValue" @change="seekTo" />

                <div class="flex justify-between items-center text-white mt-2">
                    <div class="flex items-center gap-3">
                        <button @click="togglePlay" class="px-2">
                            <span v-if="isPlaying">⏸</span>
                            <span v-else>▶️</span>
                        </button>

                        <button @click="skip(-10)" class="px-2">⏪ 10s</button>
                        <button @click="skip(10)" class="px-2">10s ⏩</button>

                        <div class="text-sm">{{ formattedTime(currentTime) }} / {{ formattedTime(duration) }}</div>
                    </div>

                    <div class="flex items-center gap-3">
                        <button @click="toggleMute" class="px-2">{{ isMuted ? '🔇' : '🔊' }}</button>
                        <input type="range" min="0" max="1" step="0.05" v-model.number="volume" @input="onVolume"
                            class="w-24" />
                        <button @click="enterFullscreen" class="px-2">⛶</button>
                    </div>
                </div>
            </div>

            <!-- subtitle text overlay (optional: show current cue) -->
            <div v-if="currentCueText"
                class="subtitle absolute bottom-20 w-full text-center text-white px-4 drop-shadow">
                <div class="inline-block bg-black/60 px-3 py-1 rounded text-sm">{{ currentCueText }}</div>
            </div>
        </div>

        <!-- title + actions -->
        <div class="mt-4">
            <h1 class="text-xl font-semibold">{{ title }}</h1>
            <div class="flex items-center gap-4 mt-2 text-gray-600">
                <button @click="$emit('like')">👍</button>
                <button @click="$emit('dislike')">👎</button>
                <button @click="$emit('share')">🔗</button>
                <button @click="$emit('save')">💾</button>
            </div>

            <!-- subtitle selector -->
            <div v-if="subtitles.length" class="mt-3 text-sm">
                <span class="mr-2">Subtitles:</span>
                <button v-for="(s, i) in subtitles" :key="i"
                    :class="['px-2 py-1 rounded mr-2', { 'bg-gray-200': activeSubtitle === i }]"
                    @click="setActiveSubtitle(i)">
                    {{ s.language }}
                </button>
                <button :class="['px-2 py-1 rounded', { 'bg-gray-200': activeSubtitle === -1 }]"
                    @click="setActiveSubtitle(-1)">Off</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRuntimeConfig } from '#imports'

const props = defineProps({
    movie: { type: Object, required: true }
})
const emit = defineEmits(['error'])

const config = useRuntimeConfig()
const backend = config.public.backendUrl.replace(/\/$/, '')

const videoEl = ref(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const isMuted = ref(false)
const seekValue = ref(0)
const subtitles = ref([]) // array of { language, vttUrl }
const activeSubtitle = ref(0)
const currentCueText = ref('')

const title = computed(() => props.movie.title || 'Untitled')
const videoSrc = computed(() => {
    // movie.videoUrl already begins with /movies/... per backend
    // join with backend base if it's a relative path
    if (!props.movie) return ''
    return props.movie.videoUrl?.startsWith('http') ? props.movie.videoUrl : `${backend}${props.movie.videoUrl}`
})

function formattedTime(time) {
    if (isNaN(time) || time === undefined || time === null) return "00:00";
    const minutes = Math.floor(time / 60)
        .toString()
        .padStart(2, "0");
    const seconds = Math.floor(time % 60)
        .toString()
        .padStart(2, "0");
    return `${minutes}:${seconds}`;
}

const syncCueText = () => {
    const v = videoEl.value
    if (!v || !v.textTracks) { currentCueText.value = ''; return }
    // iterate tracks and show first active cue text
    for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i]
        if (t.mode === 'showing') {
            const cues = t.activeCues || t.cues
            if (cues && cues.length > 0) {
                currentCueText.value = Array.from(cues).map(c => c.text).join(' ')
                return
            }
        }
    }
    currentCueText.value = ''
}

watch(() => props.movie, async (m) => {
    // update subtitles list that the <track> elements will pick up
    subtitles.value = (m.subtitles || []).map(s => {
        return {
            language: s.language,
            vttUrl: s.vttUrl?.startsWith('http') ? s.vttUrl : `${backend}${s.vttUrl}`
        }
    })
    activeSubtitle.value = subtitles.value.length ? 0 : -1

    // reset UI state
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    seekValue.value = 0

    // small hack: reload video element
    if (videoEl.value) {
        videoEl.value.pause()
        videoEl.value.src = videoSrc.value
        try { videoEl.value.load() } catch (e) { }
    }

    // update text track cues periodically (browser may need small timeout)
    setTimeout(syncCueText, 200)
}, { immediate: true })

const onTimeUpdate = () => {
    const v = videoEl.value
    currentTime.value = v.currentTime
    seekValue.value = v.currentTime
    syncCueText()
}

const onLoadedMeta = () => {
    duration.value = videoEl.value.duration || 0
}

const onVideoError = (e) => {
    emit('error', e)
}

const togglePlay = async () => {
    const v = videoEl.value
    if (!v) return
    try {
        if (v.paused) await v.play()
        else v.pause()
    } catch (err) {
        // play may be blocked; update state accordingly
        console.warn('Play blocked', err)
    } finally {
        isPlaying.value = !v.paused
    }
}

const skip = (sec) => {
    const v = videoEl.value
    if (!v || !isFinite(v.duration)) return
    v.currentTime = Math.min(Math.max(0, v.currentTime + sec), v.duration)
}

const seekTo = () => {
    const v = videoEl.value
    if (!v) return
    v.currentTime = Number(seekValue.value)
}

const onVolume = () => {
    const v = videoEl.value
    if (!v) return
    v.volume = Number(volume.value)
    isMuted.value = Number(volume.value) === 0
}

const toggleMute = () => {
    const v = videoEl.value
    if (!v) return
    v.muted = !v.muted
    isMuted.value = v.muted
}

const setActiveSubtitle = (index) => {
    activeSubtitle.value = index
    // Set the showing/hidden mode of textTracks after DOM updates
    setTimeout(() => {
        const v = videoEl.value
        if (!v || !v.textTracks) return
        for (let i = 0; i < v.textTracks.length; i++) {
            v.textTracks[i].mode = i === index ? 'showing' : 'hidden'
        }
        // index===-1 -> hide all
        if (index === -1) {
            for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'hidden'
        }
    }, 50)
}

/* Fullscreen helper (basic) */
const enterFullscreen = async () => {
    const el = videoEl.value
    if (!el) return
    try {
        if (el.requestFullscreen) await el.requestFullscreen()
        else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen() // iOS safari
    } catch (e) {
        console.warn('Fullscreen failed', e)
    }
}

onMounted(() => {
    // keep volume state in sync with actual element
    if (videoEl.value) {
        videoEl.value.volume = volume.value
        videoEl.value.muted = isMuted.value
    }
})

onBeforeUnmount(() => {
    const v = videoEl.value
    if (v && !v.paused) v.pause()
})
</script>

<style scoped>
.video-wrap {
    position: relative;
}

.controls {
    pointer-events: auto;
}

.subtitle {
    pointer-events: none;
}
</style>