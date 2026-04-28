import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/pindou-generator/', // <-- Add your repo name here, with leading and trailing slashes!
})

