import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from 'fs'
import pdf from 'pdf-parse/lib/pdf-parse.js'

const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

export const generateArticle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt, length } = req.body;

        const plan = req.plan;
        const free_usage = req.free_usage;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({
                success: false,
                message: "Limit reached. Upgrade to continue."
            });
        }

        const response = await AI.chat.completions.create({
            model: "gemini-3.6-flash",

            messages: [
                {
                    role: "user",
                    content: `${prompt}

Write a complete, detailed article.

Requirements:
- Write approximately ${length} words.
- Do not give a short summary.
- Use a clear introduction.
- Use multiple descriptive headings and subheadings.
- Explain every major point in detail.
- Include examples where appropriate.
- Use paragraphs instead of giving only bullet points.
- End with a proper conclusion.
- The final response should be a complete article, not an outline.
- Do not mention these instructions in the article.`
                }
            ],

            temperature: 0.7,
            max_tokens: Math.max(length * 2, 2000),
        });

        const content = response.choices[0].message.content;

        await sql`
            INSERT INTO creations (user_id, prompt, content, type)
            VALUES (${userId}, ${prompt}, ${content}, 'article')
        `;

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: {
                    free_usage: free_usage + 1
                }
            });
        }

        res.json({
            success: true,
            content
        });

    } catch (error) {
        console.log(error.message);

        res.json({
            success: false,
            message: error.message
        });
    }
};
export const generateBlogTitle = async (req, res) => {

    try {

        const { userId } = req.auth();
        const { prompt } = req.body;

        const plan = req.plan;
        const free_usage = req.free_usage;

        // Check free usage limit
        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({
                success: false,
                message: "Limit reached. Upgrade to continue."
            });
        }

        // Generate titles
        const response = await AI.chat.completions.create({
    model: "gemini-3.6-flash",
    messages: [
        {
            role: "user",
            content: prompt
        }
    ],
    temperature: 0.7,
    max_tokens: 1000,
});

        const content =
            response.choices[0].message.content;

        // Save creation
        await sql`
            INSERT INTO creations
            (user_id, prompt, content, type)
            VALUES
            (${userId}, ${prompt}, ${content}, 'blog-title')
        `;

        // Increase free usage
        if (plan !== 'premium') {

            await clerkClient.users.updateUserMetadata(userId, {

                privateMetadata: {
                    free_usage: free_usage + 1
                }

            });

        }

        res.json({
            success: true,
            content
        });

    } catch (error) {

        console.log(error.message);

        res.json({
            success: false,
            message: error.message
        });

    }
};


export const generateImage = async (req, res)=>{
    try {
        const { userId } = req.auth();
        const { prompt, publish } = req.body;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        
        const formData = new FormData()
        formData.append('prompt', prompt)
        const {data} = await axios.post("https://clipdrop-api.co/text-to-image/v1", formData, {
            headers: {'x-api-key': process.env.CLIPDROP_API_KEY},
            responseType: "arraybuffer",
        })

        const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`;

        const {secure_url} = await cloudinary.uploader.upload(base64Image)
        

        await sql` INSERT INTO creations (user_id, prompt, content, type, publish) 
        VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false })`;

        res.json({ success: true, content: secure_url})

    }  catch (error) {
    console.log("STATUS:", error.response?.status);
    console.log("DATA:", error.response?.data);

    let message = error.message;

    if (error.response?.data) {
        message = Buffer.from(error.response.data).toString("utf8");
    }

    res.status(error.response?.status || 500).json({
        success: false,
        message: message
    });
}
}

export const removeImageBackground = async (req, res)=>{
    try {
        const { userId } = req.auth();
        const image = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        const {secure_url} = await cloudinary.uploader.upload(image.path, {
            transformation: [
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background'
                }
            ]
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;

        res.json({ success: true, content: secure_url})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}

export const removeImageObject = async (req, res)=>{
    try {
        const { userId } = req.auth();
        const { object } = req.body;
        const image = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        const {public_id} = await cloudinary.uploader.upload(image.path)

        const imageUrl = cloudinary.url(public_id, {
            transformation: [{effect: `gen_remove:${object}`}],
            resource_type: 'image'
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`;

        res.json({ success: true, content: imageUrl})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}

export const resumeReview = async (req, res) => {
    try {
        const { userId } = req.auth();
        const resume = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({
                success: false,
                message: "This feature is only available for premium subscriptions"
            });
        }

        if (!resume) {
            return res.json({
                success: false,
                message: "Please upload a resume."
            });
        }

        if (resume.size > 5 * 1024 * 1024) {
            return res.json({
                success: false,
                message: "Resume file size exceeds allowed size (5MB)."
            });
        }

        const dataBuffer = fs.readFileSync(resume.path);
        const pdfData = await pdf(dataBuffer);

        const prompt = `
You are a professional resume reviewer and career advisor.

Analyze the following resume carefully and provide a COMPLETE, DETAILED, and STRUCTURED review.

Resume Content:
${pdfData.text}

Your response MUST contain these sections:

# Overall Impression

Give a detailed assessment of the resume and its overall quality.

# Strengths

Identify the strongest parts of the resume.
Explain WHY each strength is valuable.

# Weaknesses

Identify specific problems or weaknesses.
Explain how each weakness affects the resume.

# Skills Analysis

Analyze the technical skills, soft skills, tools, technologies, and programming languages mentioned.

# Experience Analysis

Evaluate the work experience, internships, responsibilities, and achievements.
Suggest how they can be improved.

# Projects Analysis

Analyze the projects.
Explain whether they are strong enough for a job application and suggest improvements.

# Education Analysis

Review the education section and suggest improvements if necessary.

# ATS Analysis

Evaluate the resume for Applicant Tracking Systems (ATS).

Discuss:
- Keyword usage
- Formatting
- Section structure
- Readability
- ATS compatibility

# Content Improvements

Give specific suggestions for rewriting weak or unclear content.

# Missing Information

Mention important information that appears to be missing from the resume.

# Actionable Recommendations

Give at least 8 specific improvements the candidate should make.

# Final Verdict

Give an overall rating out of 10 and explain the rating.

Important instructions:

- Be detailed and constructive.
- Do not give a short summary.
- Do not stop after the first section.
- Analyze the ENTIRE resume.
- Use Markdown headings.
- Use bullet points where appropriate.
- Give practical examples when suggesting improvements.
- Do not invent experience, skills, education, or achievements that are not present in the resume.
- If something is missing, clearly say that it is missing.
- Complete every section before finishing.
`;

        const response = await AI.chat.completions.create({
            model: "gemini-3.6-flash",

            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],

            temperature: 0.7,

            // Increase this
            max_tokens: 4000,
        });

        const content =
            response.choices[0].message.content;

        await sql`
            INSERT INTO creations
            (user_id, prompt, content, type)
            VALUES
            (
                ${userId},
                'Review the uploaded resume',
                ${content},
                'resume-review'
            )
        `;

        res.json({
            success: true,
            content
        });

    } catch (error) {

        console.log(error.message);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};