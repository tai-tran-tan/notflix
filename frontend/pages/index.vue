<!-- pages/index.vue -->
<template>
    <div class="container mx-auto p-4">
        <div v-if="loading" class="p-4">Loading movies...</div>
        <div v-else-if="error" class="p-4 text-red-600">Failed to load movies: {{ error }}</div>
        <div v-else class="flex flex-col lg:flex-row gap-6">
            <div class="flex-1">
                <YouTubePlayer v-if="selected" :movie="selected" @error="onPlayerError" @like="onLike"
                    @dislike="onDislike" @share="onShare" @save="onSave" />
            </div>

            <aside class="w-full lg:w-1/3">
                <h3 class="font-semibold mb-3">Recommended</h3>
                <div v-for="m in movies" :key="m.id" class="mb-2">
                    <div class="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-100"
                        @click="selectMovie(m)">
                        <div class="w-24 h-14 bg-gray-300 rounded-sm"></div>
                        <div>
                            <div class="font-medium">{{ m.title }}</div>
                            <div class="text-sm text-gray-500">{{ m.length || m.duration || '--:--' }} • {{ m.views ||
                                '--' }} views</div>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import YouTubePlayer from '~/components/YouTubePlayer.vue'
const config = useRuntimeConfig()
const backend = config.public.backendUrl.replace(/\/$/, '')
const movies = ref([])
const selected = ref(null)
const loading = ref(true)
const error = ref(null)

const fetchMovies = async () => {
    loading.value = true
    error.value = null
    try {
        const res = await fetch(`${backend}/api/movies`)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        movies.value = data || []
        selected.value = movies.value[0] || null
    } catch (err) {
        // fallback: empty list and show error message
        console.error('Failed to fetch movies', err)
        error.value = String(err)
        movies.value = []
        selected.value = null
    } finally {
        loading.value = false
    }
}

onMounted(fetchMovies)

const selectMovie = (m) => {
    selected.value = m
}

const onPlayerError = (e) => {
    console.error('Player error', e)
    // show user-facing toast or message if desired
}

const onLike = () => {/* implement if backend supports */ }
const onDislike = () => { }
const onShare = () => { }
const onSave = () => { }
</script>

<style scoped>
.container {
    max-width: 1100px;
}
</style>