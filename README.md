# OSDG — Open Source Data Graph

OSDG is a professional data intelligence and investigation platform that visualizes entity relationships through an interactive graph interface. It aggregates intelligence from over 24 specialized APIs to provide a comprehensive view of digital footprints, security risks, and network infrastructure.

## 🚀 Features

- **Interactive Graph Visualization**: Map complex relationships between people, domains, IPs, and more.
- **Dynamic API Dashboard**: Manage your own API keys for 24+ intelligence providers.
- **Automated Risk Scoring**: Intelligence-driven risk assessments based on breach data and reputation scores.
- **Comprehensive Reporting**: Generate detailed OSDG reports in Word (.docx) format.
- **Session Persistence**: Automatic local saving ensures you never lose your investigation progress.

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript, Vite, TailwindCSS, Shadcn UI.
- **Graph Engine**: @xyflow/react (React Flow).
- **Backend**: Supabase Edge Functions (Deno).
- **Styling**: Modern, dark-themed glassmorphism.

## ⚙️ Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### Installation
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Set up environment variables in a `.env` file (see `.env.example`).
4. Run locally: `npm run dev`.

## 📜 License

MIT License. See [LICENSE](LICENSE) for details.
