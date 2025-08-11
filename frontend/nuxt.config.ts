export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      backendUrl: process.env.BACKEND_URL || 'http://localhost:3001'
    }
  },
  //css: ['~/assets/css/tailwind.css'], // optional if you use Tailwind
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true }
})
