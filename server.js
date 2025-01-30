/**
 * @file server.js
 * Updated Date: 2025-01-30
 */

import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import cors from "cors";
import OpenAI from "openai";
import axios from "axios";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";

// ✅ Configure __dirname equivalent for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

// ✅ Load environment variables correctly
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ✅ Validate required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Error: OPENAI_API_KEY is not set.");
  process.exit(1);
}

if (!process.env.YOUTUBE_API_KEY) {
  console.warn(
    "⚠️ Warning: YOUTUBE_API_KEY is not set. YouTube results will be disabled."
  );
}

const app = express();

// ✅ Middleware Setup
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));

// ✅ Rate Limiting for API Protection
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use("/api/", limiter);

// ✅ Fixed Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    environment: process.env.NODE_ENV || "development",
    openai: !!process.env.OPENAI_API_KEY,
    youtube: !!process.env.YOUTUBE_API_KEY,
  });
});

// ✅ Initialize OpenAI API client
let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log("✅ OpenAI client initialized.");
} catch (error) {
  console.error("❌ Error initializing OpenAI client:", error.message);
}

// ✅ Function to fetch YouTube results if API key is available
async function getYouTubeResults(query) {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log("YouTube API key not found, skipping video results");
    return [];
  }

  try {
    const response = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          part: "snippet",
          maxResults: 3,
          key: process.env.YOUTUBE_API_KEY,
          q: query,
          type: "video",
        },
      }
    );

    return response.data.items.map((item) => ({
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.medium.url,
      videoId: item.id.videoId,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
  } catch (error) {
    console.error("❌ YouTube API Error:", error.message);
    return [];
  }
}

// ✅ Function to get relevant web results using DuckDuckGo
async function getWebResults(query) {
  try {
    const response = await axios.get(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    );
    const results = response.data.RelatedTopics || [];
    return results
      .filter((topic) => topic.FirstURL && topic.Text)
      .slice(0, 3)
      .map((topic) => ({
        title: topic.Text.split(" - ")[0] || topic.Text,
        description: topic.Text,
        url: topic.FirstURL,
      }));
  } catch (error) {
    console.error("❌ Web Search Error:", error.message);
    return [];
  }
}

// ✅ API Route to Handle OpenAI Requests
app.post("/api/generate", async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      error:
        "OpenAI service is not available. Please check your configuration.",
    });
  }

  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const [aiResponse, youtubeResults, webResults] = await Promise.allSettled([
      openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
      }),
      getYouTubeResults(prompt),
      getWebResults(prompt),
    ]);

    const aiResult =
      aiResponse.status === "fulfilled"
        ? aiResponse.value.choices[0]?.message?.content?.trim()
        : null;
    const youtubeData =
      youtubeResults.status === "fulfilled" ? youtubeResults.value : [];
    const webData = webResults.status === "fulfilled" ? webResults.value : [];

    if (!aiResult) {
      return res.status(500).json({ error: "Failed to retrieve AI response" });
    }

    res.json({
      aiResponse: aiResult,
      youtubeResults: youtubeData,
      webResults: webData,
    });
  } catch (error) {
    console.error("❌ Error processing request:", error.message);
    res
      .status(500)
      .json({ error: "Failed to process request. Please try again later." });
  }
});

// ✅ Serve Static Frontend (Optional, Remove if Unneeded)
const distPath = join(__dirname, "..", "dist");
app.use(express.static(distPath));

app.get("*", (req, res) => {
  res.sendFile(join(distPath, "index.html"));
});

// ✅ Final Fix: Ensure Correct Port is Used for Azure
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? "Set" : "Not set"}`
  );
  console.log(
    `📺 YouTube API Key: ${
      process.env.YOUTUBE_API_KEY ? "Enabled" : "Disabled"
    }`
  );
});

// ✅ Handle Server Shutdown Gracefully
process.on("SIGTERM", () => {
  console.log("⚠️ SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});
