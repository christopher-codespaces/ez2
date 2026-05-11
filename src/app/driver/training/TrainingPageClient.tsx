"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PlayCircle,
  CheckCircle2,
  Award,
  Lock,
  ArrowRight,
} from "lucide-react";

import { app } from "@/lib/firebase";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// ✅ NEW: modular quiz component
import QuizCard, { QuizQuestion } from "../../components/Quiz";

type ModuleStatus = "not_started" | "in_progress" | "completed";

type Module = {
  id: string;
  title: string;
  description: string;
  durationMins: number;
  videoUrl: string;
  quiz: { questions: number; passMark: number };
};

const BRAND = {
  orange: "#F36C21",
  red: "#E02020",
  dark: "#0B1220",
};

const FALLBACK_VIDEO = "https://www.youtube.com/embed/4WJLlWpzpP0?rel=0";

// ✅ MVP: 12 modules (reuse video if you don’t have it yet)
const MODULES: Module[] = [
  {
    id: "intro",
    title: "Introduction Video",
    description: "Watch this introduction before starting the training modules.",
    durationMins: 3,
    videoUrl: "https://drive.google.com/file/d/1lV65rONTwQ-oVPuWsoUEJFVk6pJq1ZHl/preview",
    quiz: { questions: 0, passMark: 0 },
  },
  {
    id: "m1",
    title: "Module 1: Introduction & Professional Mindset",
    description:
      "Become a professional driver: long-term thinking, credibility, trust, and reputation.",
    durationMins: 8,
    videoUrl: "https://www.youtube.com/embed/4WJLlWpzpP0?rel=0",
    quiz: { questions: 7, passMark: 80 },
  },
  {
    id: "m2",
    title: "Module 2: Safety & Security",
    description:
      "Personal safety, passenger protection, defensive driving, and vehicle safety checks.",
    durationMins: 10,
    videoUrl: "https://www.youtube.com/embed/1Y2cY7fT7mE?rel=0",
    quiz: { questions: 8, passMark: 80 },
  },
  {
    id: "m3",
    title: "Module 3: Customer Service Excellence",
    description:
      "Greeting passengers, reading cues, handling complaints, and de-escalation.",
    durationMins: 9,
    videoUrl: "https://www.youtube.com/embed/2Vv-BfVoq4g?rel=0",
    quiz: { questions: 8, passMark: 80 },
  },
  {
    id: "m4",
    title: "Module 4: Route Navigation & Trip Management",
    description:
      "Confirm pickup/destination, use navigation wisely, safe pickup/drop-off practices.",
    durationMins: 7,
    videoUrl: "https://www.youtube.com/embed/kXYiU_JCYtU?rel=0",
    quiz: { questions: 8, passMark: 80 },
  },
  {
    id: "m5",
    title: "Module 5: Vehicle Standards & Maintenance",
    description:
      "Daily inspection, cleanliness, preventive maintenance, and handling lost items.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 8, passMark: 80 },
  },
  {
    id: "m6",
    title: "Module 6: Law, Compliance & Impound Awareness",
    description:
      "Documentation, interacting with authorities, impound risks, and staying compliant.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 8, passMark: 80 },
  },
  {
    id: "m7",
    title: "Module 7: Distraction, Fatigue & Health Awareness",
    description:
      "Minimise distractions, fatigue signs, stress impacts, and fitness to drive.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 8, passMark: 80 },
  },
  {
    id: "m8",
    title: "Module 8: Income & Earnings Maximization",
    description:
      "Peak hours, positioning, smart trip acceptance, efficiency, and business mindset.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 7, passMark: 80 },
  },
  {
    id: "m9",
    title: "Module 9: Platform & Technology Mastery",
    description:
      "App checks, handling GPS/app issues, safety features, and route adjustments.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 7, passMark: 80 },
  },
  {
    id: "m10",
    title: "Module 10: Ethics, Reputation & Professional Responsibility",
    description:
      "Honesty, privacy, professionalism, platform rules, and long-term reputation.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 7, passMark: 80 },
  },
  {
    id: "m11",
    title: "Module 11: Emergency & Incident Response",
    description:
      "Accidents, injuries, reporting, managing aggressive passengers, and safety first.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 7, passMark: 80 },
  },
  {
    id: "m12",
    title: "Module 12: Career Growth & Next Steps",
    description:
      "Mentorship, fleet opportunities, certification benefits, and long-term growth.",
    durationMins: 8,
    videoUrl: FALLBACK_VIDEO,
    quiz: { questions: 7, passMark: 80 },
  },
];

// ✅ Extracted quizzes from your PDF (m1–m12)
const QUIZZES: Record<string, QuizQuestion[]> = {
  m1: [
    {
      id: "m1q1",
      prompt: "What best describes an e-hailing driver’s role?",
      correctKey: "B",
      options: [
        {
          key: "A",
          text: "Someone who only drives passengers from point A to B",
        },
        {
          key: "B",
          text: "A professional service provider representing themselves and the platform",
        },
        { key: "C", text: "A casual driver with no long-term responsibility" },
      ],
    },
    {
      id: "m1q2",
      prompt: "Why is long-term thinking important for e-hailing drivers?",
      correctKey: "B",
      options: [
        { key: "A", text: "Because it helps drivers complete trips faster" },
        {
          key: "B",
          text: "Because shortcuts today can damage ratings and income tomorrow",
        },
        { key: "C", text: "Because it reduces the number of trips taken" },
      ],
    },
    {
      id: "m1q3",
      prompt: "What is a driver’s personal brand made up of?",
      correctKey: "B",
      options: [
        { key: "A", text: "The car model and colour only" },
        { key: "B", text: "Behaviour, attitude, cleanliness, and consistency" },
        { key: "C", text: "The number of hours worked per day" },
      ],
    },
    {
      id: "m1q4",
      prompt: "How is driver credibility built?",
      correctKey: "B",
      options: [
        { key: "A", text: "By driving fast and finishing trips quickly" },
        {
          key: "B",
          text: "By being polite, safe, reliable, and professional on every trip",
        },
        { key: "C", text: "By arguing with passengers when necessary" },
      ],
    },
    {
      id: "m1q5",
      prompt: "Which action best shows a professional driver mindset?",
      correctKey: "B",
      options: [
        { key: "A", text: "Ignoring small details because they don’t matter" },
        {
          key: "B",
          text: "Treating every trip as important and acting consistently",
        },
        {
          key: "C",
          text: "Only being professional when the passenger is friendly",
        },
      ],
    },
    {
      id: "m1q6",
      prompt: "Why does reputation matter in e-hailing?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "It affects access to more trips, income, and long-term opportunities",
        },
        { key: "B", text: "It only affects one or two trips" },
        { key: "C", text: "It does not impact a driver’s career" },
      ],
    },
    {
      id: "m1q7",
      prompt:
        "What is the correct attitude for a professional driver under pressure?",
      correctKey: "B",
      options: [
        { key: "A", text: "React emotionally and blame traffic or passengers" },
        { key: "B", text: "Stay calm, respectful, and focused on safety" },
        { key: "C", text: "Rush the trip to finish quickly" },
      ],
    },
  ],

  m2: [
    {
      id: "m2q1",
      prompt: "What should a driver do if a pickup location feels unsafe?",
      correctKey: "B",
      options: [
        { key: "A", text: "Wait and hope the situation improves" },
        { key: "B", text: "Cancel the trip and leave safely" },
        { key: "C", text: "Proceed with the pickup to avoid cancellation" },
      ],
    },
    {
      id: "m2q2",
      prompt: "Why is defensive driving important?",
      correctKey: "B",
      options: [
        { key: "A", text: "It helps drivers finish trips faster" },
        {
          key: "B",
          text: "It reduces accidents by anticipating other road users’ actions",
        },
        { key: "C", text: "It allows drivers to ignore traffic rules" },
      ],
    },
    {
      id: "m2q3",
      prompt:
        "Which action improves safety when stopped at a traffic light or pickup point?",
      correctKey: "B",
      options: [
        { key: "A", text: "Keeping doors unlocked for convenience" },
        { key: "B", text: "Keeping doors locked and staying alert" },
        { key: "C", text: "Using the phone to check messages" },
      ],
    },
    {
      id: "m2q4",
      prompt: "What increases risk during night driving?",
      correctKey: "B",
      options: [
        { key: "A", text: "Lower traffic volume" },
        { key: "B", text: "Reduced visibility and increased crime risk" },
        { key: "C", text: "Slower driving speeds" },
      ],
    },
    {
      id: "m2q5",
      prompt: "Which behaviour helps manage distractions while driving?",
      correctKey: "B",
      options: [
        { key: "A", text: "Holding the phone for navigation" },
        { key: "B", text: "Using voice navigation and pulling over if needed" },
        { key: "C", text: "Scrolling the app at traffic lights" },
      ],
    },
    {
      id: "m2q6",
      prompt: "What should be done before starting a driving shift?",
      correctKey: "B",
      options: [
        { key: "A", text: "Immediately go online and accept trips" },
        { key: "B", text: "Perform a vehicle safety check" },
        { key: "C", text: "Wait for the first ride request" },
      ],
    },
    {
      id: "m2q7",
      prompt: "Which of the following is part of passenger protection?",
      correctKey: "B",
      options: [
        { key: "A", text: "Ignoring seatbelts to save time" },
        {
          key: "B",
          text: "Ensuring seatbelts are functional and encouraging their use",
        },
        { key: "C", text: "Allowing unsafe behaviour in the vehicle" },
      ],
    },
    {
      id: "m2q8",
      prompt: "Why should phones never be held while driving?",
      correctKey: "B",
      options: [
        { key: "A", text: "It looks unprofessional" },
        { key: "B", text: "It causes distraction and increases accident risk" },
        { key: "C", text: "It uses too much battery" },
      ],
    },
  ],

  m3: [
    {
      id: "m3q1",
      prompt: "What is the best way to greet passengers?",
      correctKey: "B",
      options: [
        { key: "A", text: "Only greet adults" },
        {
          key: "B",
          text: "Greet all passengers politely using respectful language",
        },
        { key: "C", text: "Wait for passengers to greet you first" },
      ],
    },
    {
      id: "m3q2",
      prompt: "How should a driver handle quiet passengers?",
      correctKey: "B",
      options: [
        { key: "A", text: "Force conversation to appear friendly" },
        {
          key: "B",
          text: "Respect their space and keep communication minimal",
        },
        { key: "C", text: "Assume they are unhappy" },
      ],
    },
    {
      id: "m3q3",
      prompt:
        "What is the correct approach when a passenger enjoys conversation?",
      correctKey: "B",
      options: [
        { key: "A", text: "Ignore them and focus only on driving" },
        { key: "B", text: "Engage politely while remaining professional" },
        { key: "C", text: "Share personal problems and opinions" },
      ],
    },
    {
      id: "m3q4",
      prompt:
        "When transporting families or children, what should a driver do?",
      correctKey: "B",
      options: [
        { key: "A", text: "Drive faster to finish the trip quickly" },
        { key: "B", text: "Drive smoothly and ensure seatbelts are secure" },
        { key: "C", text: "Allow unsafe behaviour in the vehicle" },
      ],
    },
    {
      id: "m3q5",
      prompt: "How should a driver respond to complaints?",
      correctKey: "B",
      options: [
        { key: "A", text: "Argue and defend themselves" },
        { key: "B", text: "Stay calm, listen, and acknowledge the concern" },
        { key: "C", text: "Ignore the passenger" },
      ],
    },
    {
      id: "m3q6",
      prompt: "What should a driver do if a passenger makes an unsafe request?",
      correctKey: "B",
      options: [
        { key: "A", text: "Agree to avoid a bad rating" },
        { key: "B", text: "Politely refuse and prioritise safety" },
        { key: "C", text: "Cancel the ride immediately without explanation" },
      ],
    },
    {
      id: "m3q7",
      prompt: "Why is de-escalation important in customer service?",
      correctKey: "B",
      options: [
        { key: "A", text: "It avoids responsibility" },
        {
          key: "B",
          text: "It prevents conflict and protects ratings and safety",
        },
        { key: "C", text: "It shortens trip time" },
      ],
    },
    {
      id: "m3q8",
      prompt: "What is the key goal of excellent customer service?",
      correctKey: "B",
      options: [
        { key: "A", text: "Talking as much as possible" },
        {
          key: "B",
          text: "Making passengers feel safe, respected, and comfortable",
        },
        { key: "C", text: "Completing trips as quickly as possible" },
      ],
    },
  ],

  m4: [
    {
      id: "m4q1",
      prompt: "What should a driver do before starting a trip?",
      correctKey: "B",
      options: [
        { key: "A", text: "Start driving immediately" },
        { key: "B", text: "Confirm pickup point and destination" },
        { key: "C", text: "Wait for passenger instructions only" },
      ],
    },
    {
      id: "m4q2",
      prompt: "How should a driver treat navigation apps?",
      correctKey: "B",
      options: [
        { key: "A", text: "Follow them blindly at all times" },
        { key: "B", text: "Use them as guides and apply judgment when needed" },
        { key: "C", text: "Ignore them completely" },
      ],
    },
    {
      id: "m4q3",
      prompt:
        "What is the best response when a passenger requests a different route?",
      correctKey: "B",
      options: [
        { key: "A", text: "Ignore the request and follow GPS" },
        { key: "B", text: "Follow the request if it is safe and legal" },
        { key: "C", text: "Argue with the passenger" },
      ],
    },
    {
      id: "m4q4",
      prompt: "Why is paying attention to house numbers important?",
      correctKey: "B",
      options: [
        { key: "A", text: "It saves fuel" },
        { key: "B", text: "It ensures accurate pickup and drop-off locations" },
        { key: "C", text: "It increases speed" },
      ],
    },
    {
      id: "m4q5",
      prompt: "What should a driver avoid during pickup or drop-off?",
      correctKey: "B",
      options: [
        { key: "A", text: "Stopping safely near the location" },
        { key: "B", text: "Blocking traffic unnecessarily" },
        { key: "C", text: "Communicating with the passenger" },
      ],
    },
    {
      id: "m4q6",
      prompt:
        "If a passenger is not at the pickup point, what is the safest action?",
      correctKey: "B",
      options: [
        { key: "A", text: "Stop anywhere and wait" },
        { key: "B", text: "Drive slowly, turn safely, and return if needed" },
        { key: "C", text: "Cancel immediately without attempting contact" },
      ],
    },
    {
      id: "m4q7",
      prompt:
        "What should a driver do at drop-off if the passenger is unfamiliar with the area?",
      correctKey: "B",
      options: [
        { key: "A", text: "Drop them quickly and leave" },
        {
          key: "B",
          text: "Assist briefly to help locate the correct destination",
        },
        { key: "C", text: "Tell them to figure it out themselves" },
      ],
    },
    {
      id: "m4q8",
      prompt: "How should unsafe locations be handled?",
      correctKey: "B",
      options: [
        { key: "A", text: "Proceed to avoid cancellation" },
        {
          key: "B",
          text: "Communicate clearly and prioritise safety, cancelling if necessary",
        },
        { key: "C", text: "Ignore safety concerns" },
      ],
    },
  ],

  m5: [
    {
      id: "m5q1",
      prompt: "Why is daily vehicle inspection important?",
      correctKey: "B",
      options: [
        { key: "A", text: "It looks professional only" },
        { key: "B", text: "It helps prevent breakdowns and safety risks" },
        { key: "C", text: "It is optional for experienced drivers" },
      ],
    },
    {
      id: "m5q2",
      prompt: "Which items should be checked before every shift?",
      correctKey: "A",
      options: [
        { key: "A", text: "Tyres, oil, water, lights, and brakes" },
        { key: "B", text: "Radio stations only" },
        { key: "C", text: "Passenger preferences" },
      ],
    },
    {
      id: "m5q3",
      prompt: "Why does vehicle cleanliness matter?",
      correctKey: "B",
      options: [
        { key: "A", text: "It improves fuel efficiency" },
        { key: "B", text: "It affects passenger comfort, trust, and ratings" },
        { key: "C", text: "It reduces driving time" },
      ],
    },
    {
      id: "m5q4",
      prompt: "What is preventive maintenance?",
      correctKey: "B",
      options: [
        { key: "A", text: "Waiting until the car breaks down" },
        {
          key: "B",
          text: "Fixing small issues before they become serious problems",
        },
        { key: "C", text: "Ignoring warning signs" },
      ],
    },
    {
      id: "m5q5",
      prompt:
        "What should a driver do if they hear unusual noises or see warning lights?",
      correctKey: "B",
      options: [
        { key: "A", text: "Ignore them and continue driving" },
        { key: "B", text: "Investigate and fix the issue early" },
        { key: "C", text: "Turn up the radio" },
      ],
    },
    {
      id: "m5q6",
      prompt:
        "What is the correct action if a passenger leaves an item in the car?",
      correctKey: "B",
      options: [
        { key: "A", text: "Keep it and wait for the passenger to call" },
        {
          key: "B",
          text: "Contact the rider and report it through the platform",
        },
        { key: "C", text: "Throw it away" },
      ],
    },
    {
      id: "m5q7",
      prompt: "When should a driver check for left-behind items?",
      correctKey: "B",
      options: [
        { key: "A", text: "Only at the end of the day" },
        { key: "B", text: "After every trip" },
        { key: "C", text: "Only when a passenger calls" },
      ],
    },
    {
      id: "m5q8",
      prompt: "How should parcels and luggage be handled?",
      correctKey: "B",
      options: [
        { key: "A", text: "Carelessly, as long as the trip is completed" },
        {
          key: "B",
          text: "Safely and responsibly to protect passenger property",
        },
        { key: "C", text: "Only when the passenger requests help" },
      ],
    },
  ],

  m6: [
    {
      id: "m6q1",
      prompt: "Why is understanding local regulations important?",
      correctKey: "B",
      options: [
        { key: "A", text: "It helps drivers avoid passengers" },
        {
          key: "B",
          text: "It protects vehicles, income, and driving privileges",
        },
        { key: "C", text: "It increases trip speed" },
      ],
    },
    {
      id: "m6q2",
      prompt: "Which documents should always be valid and available?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "Driver’s license, vehicle registration, roadworthy, and insurance",
        },
        { key: "B", text: "Only the e-hailing app" },
        { key: "C", text: "Passenger details" },
      ],
    },
    {
      id: "m6q3",
      prompt: "What is the correct behaviour when stopped by authorities?",
      correctKey: "B",
      options: [
        { key: "A", text: "Panic and argue" },
        { key: "B", text: "Remain calm, polite, and professional" },
        { key: "C", text: "Refuse to communicate" },
      ],
    },
    {
      id: "m6q4",
      prompt: "When do most impound operations usually occur?",
      correctKey: "B",
      options: [
        { key: "A", text: "Late at night only" },
        { key: "B", text: "During targeted operations, often in the morning" },
        { key: "C", text: "Randomly with no pattern" },
      ],
    },
    {
      id: "m6q5",
      prompt: "What is a common reason for vehicle impoundment?",
      correctKey: "B",
      options: [
        { key: "A", text: "Low passenger ratings" },
        { key: "B", text: "Missing permits or expired documents" },
        { key: "C", text: "Driving slowly" },
      ],
    },
    {
      id: "m6q6",
      prompt:
        "How should a driver respond if asked to step outside the vehicle?",
      correctKey: "B",
      options: [
        { key: "A", text: "Refuse immediately" },
        { key: "B", text: "Politely ask for the reason and comply lawfully" },
        { key: "C", text: "Argue with the officer" },
      ],
    },
    {
      id: "m6q7",
      prompt:
        "Are authorities allowed to search a passenger’s phone without legal process?",
      correctKey: "B",
      options: [
        { key: "A", text: "Yes, anytime" },
        { key: "B", text: "No, not without proper legal authority" },
        { key: "C", text: "Only during peak hours" },
      ],
    },
    {
      id: "m6q8",
      prompt: "How can drivers best avoid impoundment?",
      correctKey: "B",
      options: [
        { key: "A", text: "Avoid certain areas permanently" },
        { key: "B", text: "Stay compliant, informed, and professional" },
        { key: "C", text: "Drive only at night" },
      ],
    },
  ],

  m7: [
    {
      id: "m7q1",
      prompt: "What is a common driving distraction?",
      correctKey: "B",
      options: [
        { key: "A", text: "Watching the road carefully" },
        { key: "B", text: "Using a phone or adjusting apps while driving" },
        { key: "C", text: "Keeping both hands on the wheel" },
      ],
    },
    {
      id: "m7q2",
      prompt: "Why is fatigue dangerous for drivers?",
      correctKey: "B",
      options: [
        { key: "A", text: "It saves fuel" },
        { key: "B", text: "It slows reaction time and affects judgment" },
        { key: "C", text: "It improves focus" },
      ],
    },
    {
      id: "m7q3",
      prompt: "Which is a warning sign of driver fatigue?",
      correctKey: "B",
      options: [
        { key: "A", text: "Clear vision" },
        { key: "B", text: "Frequent yawning and heavy eyes" },
        { key: "C", text: "Increased alertness" },
      ],
    },
    {
      id: "m7q4",
      prompt: "What should a driver do when feeling tired?",
      correctKey: "B",
      options: [
        { key: "A", text: "Drink more coffee and continue" },
        { key: "B", text: "Stop safely and rest" },
        { key: "C", text: "Speed up to finish faster" },
      ],
    },
    {
      id: "m7q5",
      prompt: "How does stress affect driving?",
      correctKey: "B",
      options: [
        { key: "A", text: "It improves concentration" },
        { key: "B", text: "It reduces focus and decision-making ability" },
        { key: "C", text: "It has no effect" },
      ],
    },
    {
      id: "m7q6",
      prompt: "Which statement about alcohol and drugs is TRUE?",
      correctKey: "B",
      options: [
        { key: "A", text: "Small amounts are safe for experienced drivers" },
        { key: "B", text: "They impair judgment and reaction time" },
        { key: "C", text: "Only illegal drugs are dangerous" },
      ],
    },
    {
      id: "m7q7",
      prompt: "Why should drivers be cautious with medication?",
      correctKey: "B",
      options: [
        { key: "A", text: "All medication is dangerous" },
        {
          key: "B",
          text: "Some medications cause drowsiness or slow reactions",
        },
        { key: "C", text: "Medication improves driving skills" },
      ],
    },
    {
      id: "m7q8",
      prompt:
        "What is the professional driver’s responsibility regarding health?",
      correctKey: "B",
      options: [
        { key: "A", text: "Ignore health until problems appear" },
        { key: "B", text: "Ensure they are fit, alert, and safe to drive" },
        { key: "C", text: "Drive regardless of condition" },
      ],
    },
  ],

  m8: [
    {
      id: "m8q1",
      prompt:
        "What is the main benefit of understanding incentives and peak hours?",
      correctKey: "B",
      options: [
        { key: "A", text: "Work fewer hours without planning" },
        {
          key: "B",
          text: "Position yourself when demand and earnings are highest",
        },
        { key: "C", text: "Accept every trip regardless of distance" },
      ],
    },
    {
      id: "m8q2",
      prompt: "What is a smart trip acceptance strategy?",
      correctKey: "C",
      options: [
        { key: "A", text: "Accept every trip to keep the app happy" },
        { key: "B", text: "Only accept short trips close to home" },
        { key: "C", text: "Balance distance, payout, direction, and safety" },
      ],
    },
    {
      id: "m8q3",
      prompt: "Which action helps improve fuel and cost efficiency?",
      correctKey: "B",
      options: [
        { key: "A", text: "Aggressive driving to finish trips faster" },
        { key: "B", text: "Regular vehicle maintenance and smooth driving" },
        { key: "C", text: "Keeping the engine running when parked" },
      ],
    },
    {
      id: "m8q4",
      prompt: "What is strategic positioning?",
      correctKey: "B",
      options: [
        { key: "A", text: "Waiting anywhere and hoping for trips" },
        {
          key: "B",
          text: "Parking close to restaurants, malls, offices, and hotspots",
        },
        { key: "C", text: "Staying far from busy areas to avoid traffic" },
      ],
    },
    {
      id: "m8q5",
      prompt: "Why is chasing long-distance trips not always profitable?",
      correctKey: "B",
      options: [
        { key: "A", text: "Long trips are always bad" },
        {
          key: "B",
          text: "They may pay more but increase fuel and time costs",
        },
        { key: "C", text: "Platforms discourage long trips" },
      ],
    },
    {
      id: "m8q6",
      prompt: "What is the best approach to tips and rider satisfaction?",
      correctKey: "B",
      options: [
        { key: "A", text: "Asking passengers directly for tips" },
        {
          key: "B",
          text: "Providing professional, friendly, and smooth service",
        },
        { key: "C", text: "Talking constantly during the trip" },
      ],
    },
    {
      id: "m8q7",
      prompt: "Which mindset leads to long-term income growth?",
      correctKey: "B",
      options: [
        { key: "A", text: "Short-term thinking and rushing trips" },
        { key: "B", text: "Treating driving as a professional business" },
        { key: "C", text: "Working only when bored" },
      ],
    },
  ],

  m9: [
    {
      id: "m9q1",
      prompt: "Why is it important to check the app before your shift?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "To make sure notifications and location are accurate",
        },
        { key: "B", text: "To watch videos while waiting" },
        { key: "C", text: "It is not necessary" },
      ],
    },
    {
      id: "m9q2",
      prompt:
        "What should you do if the app GPS lags or freezes during a trip?",
      correctKey: "B",
      options: [
        { key: "A", text: "Panic and cancel the trip" },
        { key: "B", text: "Restart the app or use backup navigation" },
        { key: "C", text: "Ignore the passenger’s instructions" },
      ],
    },
    {
      id: "m9q3",
      prompt: "How should you handle a passenger requesting a specific route?",
      correctKey: "B",
      options: [
        { key: "A", text: "Always ignore and follow GPS" },
        { key: "B", text: "Listen carefully and adjust safely" },
        { key: "C", text: "Cancel the trip immediately" },
      ],
    },
    {
      id: "m9q4",
      prompt: "What is the purpose of emergency buttons in the app?",
      correctKey: "B",
      options: [
        { key: "A", text: "To pause the trip" },
        { key: "B", text: "To alert the platform if you feel unsafe" },
        { key: "C", text: "To increase your rating" },
      ],
    },
    {
      id: "m9q5",
      prompt: "How can professional drivers use technology effectively?",
      correctKey: "B",
      options: [
        { key: "A", text: "By letting the app make all decisions" },
        {
          key: "B",
          text: "By mastering the app, following instructions, and using safety features",
        },
        { key: "C", text: "By avoiding app updates" },
      ],
    },
    {
      id: "m9q6",
      prompt: "Why is sharing trip location with trusted contacts important?",
      correctKey: "B",
      options: [
        { key: "A", text: "To brag about earnings" },
        { key: "B", text: "For safety and quick assistance if needed" },
        { key: "C", text: "To get free rides" },
      ],
    },
    {
      id: "m9q7",
      prompt: "What is the main benefit of mastering the e-hailing app?",
      correctKey: "A",
      options: [
        { key: "A", text: "Faster trips, safer rides, and higher earnings" },
        { key: "B", text: "Fewer passengers" },
        { key: "C", text: "Ignoring passenger needs" },
      ],
    },
  ],

  m10: [
    {
      id: "m10q1",
      prompt: "Why is honesty important for e-hailing drivers?",
      correctKey: "A",
      options: [
        { key: "A", text: "It builds trust and maintains your reputation" },
        { key: "B", text: "It allows you to take shortcuts" },
        { key: "C", text: "It is optional if you are experienced" },
      ],
    },
    {
      id: "m10q2",
      prompt: "Which is a good practice for respecting passenger privacy?",
      correctKey: "B",
      options: [
        { key: "A", text: "Recording conversations secretly" },
        {
          key: "B",
          text: "Never sharing personal details and maintaining discretion",
        },
        { key: "C", text: "Asking personal questions during the trip" },
      ],
    },
    {
      id: "m10q3",
      prompt: "How do small professional actions affect a driver?",
      correctKey: "B",
      options: [
        { key: "A", text: "They have no effect" },
        {
          key: "B",
          text: "They build trust, improve ratings, and strengthen your reputation",
        },
        { key: "C", text: "They only matter for tips" },
      ],
    },
    {
      id: "m10q4",
      prompt: "Why is trust in the e-hailing ecosystem important?",
      correctKey: "B",
      options: [
        { key: "A", text: "Because platforms punish dishonesty" },
        {
          key: "B",
          text: "Because a single complaint can damage rating, income, and credibility",
        },
        { key: "C", text: "Because it guarantees maximum trips" },
      ],
    },
    {
      id: "m10q5",
      prompt: "What does professional responsibility include?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "Following platform rules, obeying traffic laws, and prioritizing safety",
        },
        { key: "B", text: "Taking shortcuts to finish trips faster" },
        { key: "C", text: "Ignoring passengers’ requests" },
      ],
    },
    {
      id: "m10q6",
      prompt: "How should a professional driver view each trip?",
      correctKey: "B",
      options: [
        { key: "A", text: "As a routine task with no impact" },
        {
          key: "B",
          text: "As an opportunity to build trust, maintain integrity, and grow their brand",
        },
        { key: "C", text: "As a way to finish quickly for the next trip" },
      ],
    },
    {
      id: "m10q7",
      prompt:
        "What is the main outcome of maintaining ethics and professional responsibility?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "Higher earnings, better ratings, and long-term career success",
        },
        { key: "B", text: "Fewer trips" },
        { key: "C", text: "Faster navigation" },
      ],
    },
  ],

  m11: [
    {
      id: "m11q1",
      prompt: "What should be your first action after an accident?",
      correctKey: "B",
      options: [
        { key: "A", text: "Continue driving" },
        {
          key: "B",
          text: "Stop safely, switch on hazard lights, and assess the situation",
        },
        { key: "C", text: "Call the next passenger immediately" },
      ],
    },
    {
      id: "m11q2",
      prompt: "Who should you contact if someone is injured?",
      correctKey: "A",
      options: [
        { key: "A", text: "Emergency services" },
        { key: "B", text: "Only the passenger’s friends" },
        { key: "C", text: "Wait and see if they recover" },
      ],
    },
    {
      id: "m11q3",
      prompt: "Why is reporting the incident through the app important?",
      correctKey: "A",
      options: [
        { key: "A", text: "It protects you and the passenger" },
        { key: "B", text: "It is optional" },
        { key: "C", text: "Only to get extra rating points" },
      ],
    },
    {
      id: "m11q4",
      prompt:
        "What should you do when dealing with aggressive or intoxicated passengers?",
      correctKey: "B",
      options: [
        { key: "A", text: "Confront them aggressively" },
        {
          key: "B",
          text: "Stay calm, avoid confrontation, and use polite communication",
        },
        { key: "C", text: "Ignore them and keep driving" },
      ],
    },
    {
      id: "m11q5",
      prompt:
        "When is it acceptable to end a trip early due to passenger behavior?",
      correctKey: "B",
      options: [
        { key: "A", text: "Never" },
        {
          key: "B",
          text: "When it’s unsafe, using the app’s emergency features",
        },
        { key: "C", text: "Only if the passenger refuses to pay" },
      ],
    },
    {
      id: "m11q6",
      prompt:
        "Which of the following is critical to have ready before emergencies occur?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "Emergency contacts, local authorities, and platform support numbers",
        },
        { key: "B", text: "Only your next ride’s pickup info" },
        { key: "C", text: "Only cash for fines" },
      ],
    },
    {
      id: "m11q7",
      prompt: "Why is prioritizing safety over completing a trip important?",
      correctKey: "B",
      options: [
        { key: "A", text: "Completing the trip is more important" },
        {
          key: "B",
          text: "Life and well-being are more important than earnings",
        },
        { key: "C", text: "Only affects ratings" },
      ],
    },
  ],

  m12: [
    {
      id: "m12q1",
      prompt: "Why is mentorship important for drivers?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "It allows experienced drivers to guide new drivers on best practices",
        },
        { key: "B", text: "Only for earning extra tips" },
        { key: "C", text: "Optional and unnecessary" },
      ],
    },
    {
      id: "m12q2",
      prompt: "What is a benefit of fleet opportunities?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "Managing multiple vehicles or leading a driver team",
        },
        { key: "B", text: "Avoiding driving yourself" },
        { key: "C", text: "Ignoring platform rules" },
      ],
    },
    {
      id: "m12q3",
      prompt:
        "Why should drivers aim for certification and higher-tier status?",
      correctKey: "B",
      options: [
        { key: "A", text: "It looks good on social media" },
        { key: "B", text: "Priority trips, bonuses, and better earnings" },
        { key: "C", text: "Only matters for long-distance trips" },
      ],
    },
    {
      id: "m12q4",
      prompt: "Which skills help drivers grow beyond daily rides?",
      correctKey: "A",
      options: [
        {
          key: "A",
          text: "Customer service, safety, navigation, and vehicle management",
        },
        { key: "B", text: "Only driving fast" },
        { key: "C", text: "Ignoring passengers’ preferences" },
      ],
    },
    {
      id: "m12q5",
      prompt:
        "What is the mindset of a professional driver thinking about career growth?",
      correctKey: "B",
      options: [
        { key: "A", text: "Short-term trips only" },
        {
          key: "B",
          text: "Long-term goals, personal development, and business growth",
        },
        { key: "C", text: "Only focusing on daily earnings" },
      ],
    },
    {
      id: "m12q6",
      prompt: "How can drivers leverage experience for future opportunities?",
      correctKey: "B",
      options: [
        { key: "A", text: "Treat driving as just a job" },
        {
          key: "B",
          text: "Apply learned skills to logistics, fleet management, or entrepreneurship",
        },
        { key: "C", text: "Avoid learning extra skills" },
      ],
    },
    {
      id: "m12q7",
      prompt: "What is the ultimate goal of planning your career as a driver?",
      correctKey: "B",
      options: [
        { key: "A", text: "Maximize daily trips only" },
        { key: "B", text: "Build long-term income, independence, and growth" },
        { key: "C", text: "Only aim for platform rewards" },
      ],
    },
  ],
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}
function percent(n: number, d: number) {
  if (d <= 0) return 0;
  return clamp(Math.round((n / d) * 100));
}

type ProgressMap = Record<string, { status: ModuleStatus; quizScore?: number }>;

export default function TrainingPage() {
  const db = useMemo(() => (app ? getFirestore(app) : null), []);
  const auth = useMemo(() => (app ? getAuth(app) : null), []);

  const [user, setUser] = useState<User | null>(null);

  // ✅ Local state (UI uses this)
  const [progress, setProgress] = useState<ProgressMap>({});
  const [activeId, setActiveId] = useState(MODULES[0]?.id ?? "");

  const activeModule = useMemo(
    () => MODULES.find((m) => m.id === activeId) ?? MODULES[0],
    [activeId],
  );

  // ✅ Auth listener
  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [auth]);

  // ✅ Firestore load (when user becomes available)
  useEffect(() => {
    if (!user?.uid) return;
    if (!db) return;

    const load = async () => {
      // fallback: localStorage first (fast UI)
      try {
        const raw = localStorage.getItem("ewr_training_progress");
        if (raw) setProgress(JSON.parse(raw));
      } catch {}

      // then overwrite from Firestore (source of truth)
      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const data = snap.data() as any;
          const tp = (data?.trainingProgress ?? {}) as any;

          const next: ProgressMap = {};
          for (const mod of MODULES) {
            const status = tp?.[mod.id]?.status as ModuleStatus | undefined;
            const quizScore = tp?.[mod.id]?.quiz?.lastScore as
              | number
              | undefined;
            if (status || typeof quizScore === "number") {
              next[mod.id] = {
                status: status ?? "not_started",
                ...(typeof quizScore === "number" ? { quizScore } : {}),
              };
            }
          }
          setProgress((p) => ({ ...p, ...next }));
        } else {
          await setDoc(
            userRef,
            { createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
            { merge: true },
          );
        }
      } catch (e) {
        console.warn("Failed to load trainingProgress from Firestore:", e);
      }
    };

    load();
  }, [user?.uid, db]);

  // ✅ Persist to localStorage (keeps UI smooth + backup)
  useEffect(() => {
    try {
      localStorage.setItem("ewr_training_progress", JSON.stringify(progress));
    } catch {}
  }, [progress]);

  const getStatus = (id: string): ModuleStatus =>
    progress[id]?.status ?? "not_started";

  const moduleIndex = useMemo(
    () => MODULES.findIndex((m) => m.id === activeId),
    [activeId],
  );

  const isLocked = (id: string) => {
    const idx = MODULES.findIndex((m) => m.id === id);
    if (idx <= 0) return false;
    const prev = MODULES[idx - 1];
    return getStatus(prev.id) !== "completed";
  };

  const completedCount = useMemo(
    () => MODULES.filter((m) => getStatus(m.id) === "completed").length,
    [progress],
  );

  const overallPct = useMemo(
    () => percent(completedCount, MODULES.length),
    [completedCount],
  );

  const certified = overallPct === 100;

  // ✅ Firestore writer helper (manual status buttons)
  const writeStatus = async (moduleId: string, status: ModuleStatus) => {
    setProgress((p) => ({ ...p, [moduleId]: { ...p[moduleId], status } }));

    if (!user?.uid || !db) return;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`trainingProgress.${moduleId}.status`]: status,
        updatedAt: serverTimestamp(),
        lastTrainingUpdatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Failed to write trainingProgress:", e);
    }
  };

  const markInProgress = (id: string) => writeStatus(id, "in_progress");
  const completeModule = (id: string) => writeStatus(id, "completed");

  const goNext = () => {
    const next = MODULES[moduleIndex + 1];
    if (!next) return;
    if (isLocked(next.id)) return;
    setActiveId(next.id);
  };

  const activeQuiz = QUIZZES[activeModule.id] ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1
              className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-slate-100
">
              Driver Training
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Watch modules, mark progress, and complete quizzes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm min-w-[220px]">
              <p className="text-xs text-gray-500">Overall completion</p>
              <p
                className="text-lg font-semibold text-gray-900 dark:text-slate-100
">
                {overallPct}%
              </p>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${overallPct}%`,
                    backgroundColor: BRAND.orange,
                  }}
                />
              </div>
            </div>

            {certified && (
              <div className="rounded-2xl border bg-orange-50 px-4 py-3 shadow-sm flex items-center gap-2">
                <Award className="text-orange-600" />
                <div>
                  <p className="text-xs text-gray-600">Status</p>
                  <p
                    className="font-semibold text-gray-900 dark:text-slate-100
">
                    Certified
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Module list */}
        <aside className="lg:col-span-1">
          <div className="rounded-2xl border bg-white shadow-sm p-4">
            <h2
              className="text-lg font-semibold text-gray-900 dark:text-slate-100
">
              Training Modules
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Complete in order to unlock the next module.
            </p>

            <div className="mt-4 space-y-2">
              {MODULES.map((m, idx) => {
                const status = getStatus(m.id);
                const locked = isLocked(m.id);
                const active = m.id === activeId;

                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (locked) return;
                      setActiveId(m.id);
                    }}
                    className={[
                      "w-full text-left rounded-2xl border p-4 transition",
                      active ? "border-orange-200 bg-orange-50" : "bg-white",
                      locked
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:bg-gray-50",
                    ].join(" ")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className="text-sm font-semibold text-gray-900 dark:text-slate-100
 truncate">
                          {m.title}
                        </p>
                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                          {m.description}
                        </p>

                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                          <span>{m.durationMins} mins</span>
                          <span>•</span>
                          <span>{m.quiz.questions} Qs</span>
                          <span>•</span>
                          <span>Pass {m.quiz.passMark}%</span>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {locked ? (
                          <div className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                            <Lock size={14} /> Locked
                          </div>
                        ) : status === "completed" ? (
                          <div className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">
                            <CheckCircle2 size={14} /> Done
                          </div>
                        ) : status === "in_progress" ? (
                          <div className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                            <PlayCircle size={14} /> In progress
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                            <PlayCircle size={14} /> Start
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-700 font-semibold">
                        {idx + 1}
                      </span>
                      {active ? (
                        <span
                          className="font-semibold text-gray-900 dark:text-slate-100
">
                          Currently viewing
                        </span>
                      ) : (
                        <span>Module</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right */}
        <section className="lg:col-span-2 space-y-6">
          {/* Player */}
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="p-5 border-b">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Now Playing
                  </p>
                  <h2
                    className="text-xl font-semibold text-gray-900 dark:text-slate-100
 mt-1">
                    {activeModule.title}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {activeModule.description}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xs text-gray-500">Module status</p>
                  <p
                    className="text-sm font-semibold text-gray-900 dark:text-slate-100
">
                    {getStatus(activeModule.id).replace("_", " ")}
                  </p>
                  {typeof progress[activeModule.id]?.quizScore === "number" && (
                    <p className="text-xs text-gray-500 mt-1">
                      Last quiz:{" "}
                      <span
                        className="font-semibold text-gray-900 dark:text-slate-100
">
                        {progress[activeModule.id]?.quizScore}%
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="aspect-video bg-black">
              <iframe
                src={activeModule.videoUrl || FALLBACK_VIDEO}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={activeModule.title}
              />
            </div>

            <div className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <PlayCircle className="text-orange-600" size={18} />
                <span>Mark as “In progress” while you watch.</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => markInProgress(activeModule.id)}
                  className="px-4 py-2 rounded-xl border text-sm font-semibold hover:bg-gray-50 transition">
                  Mark in progress
                </button>

                <button
                  onClick={() => completeModule(activeModule.id)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition"
                  style={{ backgroundColor: BRAND.orange }}>
                  Mark completed
                </button>
              </div>
            </div>
          </div>

          {/* ✅ NEW: Modular quiz */}
          <QuizCard
            key={activeModule.id} // ✅ THIS FORCES RESET PER MODULE
            moduleId={activeModule.id}
            passMark={activeModule.quiz.passMark}
            questions={activeQuiz}
            onPassed={(scorePct) => {
              // keep UI in sync immediately (QuizCard also writes Firestore)
              setProgress((p) => ({
                ...p,
                [activeModule.id]: {
                  ...(p[activeModule.id] ?? {
                    status: "not_started" as ModuleStatus,
                  }),
                  status: "completed",
                  quizScore: scorePct,
                },
              }));
            }}
            onFailed={(scorePct) => {
              setProgress((p) => ({
                ...p,
                [activeModule.id]: {
                  ...(p[activeModule.id] ?? {
                    status: "not_started" as ModuleStatus,
                  }),
                  status:
                    p[activeModule.id]?.status === "completed"
                      ? "completed"
                      : "in_progress",
                  quizScore: scorePct,
                },
              }));
            }}
          />

          {/* Accomplishment */}
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  className="text-lg font-semibold text-gray-900 dark:text-slate-100
">
                  Accomplishment
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Complete modules to unlock certification.
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                <Award size={18} />
              </div>
            </div>

            <button
              onClick={goNext}
              disabled={
                !MODULES[moduleIndex + 1] ||
                isLocked(MODULES[moduleIndex + 1]?.id)
              }
              className="mt-4 w-full px-4 py-3 rounded-xl text-sm font-semibold border hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              Next module <ArrowRight size={16} />
            </button>

            {certified && (
              <div className="mt-4 rounded-2xl bg-orange-50 border border-orange-200 p-4">
                <p
                  className="text-sm font-semibold text-gray-900 dark:text-slate-100
">
                  🎉 You’re fully certified!
                </p>
                <p className="text-sm text-gray-700 mt-1">
                  Your training is complete. You can now be prioritised by
                  businesses.
                </p>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500">
            Note: Replace placeholder videos any time. Quizzes are extracted
            from your PDF.
          </div>
        </section>
      </div>
    </div>
  );
}
