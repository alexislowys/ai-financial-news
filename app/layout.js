// app/layout.js
// The root layout wraps every page. Think of it as the HTML shell.
import "./globals.css";

export const metadata = {
  title: "AI Financial News Summarizer",
  description:
    "Aggregates financial news and summarizes market-moving events with AI sentiment analysis.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
