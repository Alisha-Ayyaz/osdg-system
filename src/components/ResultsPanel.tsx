import { motion } from "framer-motion";
import { User, Mail, MapPin, Briefcase, Globe, Calendar } from "lucide-react";

interface ResultsPanelProps {
  query: string;
  isVisible: boolean;
}

const mockData = {
  profile: {
    name: "Entity Profile",
    fields: [
      { icon: User, label: "Full Name", value: "Loading from sources..." },
      { icon: Mail, label: "Email", value: "Aggregating..." },
      { icon: MapPin, label: "Location", value: "Cross-referencing..." },
      { icon: Briefcase, label: "Occupation", value: "Analyzing..." },
      { icon: Globe, label: "Website", value: "Scanning..." },
      { icon: Calendar, label: "Active Since", value: "Calculating..." },
    ],
  },
  timeline: [
    { platform: "Twitter", event: "Account created", date: "2019-03-12" },
    { platform: "LinkedIn", event: "Profile updated", date: "2024-01-15" },
    { platform: "YouTube", event: "Channel activity", date: "2024-11-20" },
    { platform: "Google", event: "Public mention", date: "2025-02-01" },
  ],
};

const ResultsPanel = ({ query, isVisible }: ResultsPanelProps) => {
  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="w-full max-w-4xl mx-auto mt-12 space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <h2 className="font-mono text-sm text-accent">
          INTEL REPORT — <span className="text-foreground">{query.toUpperCase()}</span>
        </h2>
      </div>

      {/* Profile Card */}
      <div className="glass-card rounded-lg p-6">
        <h3 className="font-mono text-xs text-primary mb-4 tracking-wider">
          ▸ AGGREGATED PROFILE
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mockData.profile.fields.map((field, i) => (
            <motion.div
              key={field.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              className="flex items-center gap-3"
            >
              <field.icon className="h-4 w-4 text-primary shrink-0" />
              <div>
                <span className="text-xs text-muted-foreground font-mono">{field.label}</span>
                <p className="text-sm text-foreground">{field.value}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="glass-card rounded-lg p-6">
        <h3 className="font-mono text-xs text-primary mb-4 tracking-wider">
          ▸ ACTIVITY TIMELINE
        </h3>
        <div className="space-y-3">
          {mockData.timeline.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.1 }}
              className="flex items-center gap-4 text-sm"
            >
              <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">
                {item.date}
              </span>
              <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <span className="text-foreground">
                <span className="text-primary font-mono text-xs">[{item.platform}]</span>{" "}
                {item.event}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-center text-xs text-muted-foreground font-mono mt-8">
        ⚠ Data sourced from publicly accessible information only. For demonstration purposes.
      </p>
    </motion.div>
  );
};

export default ResultsPanel;
