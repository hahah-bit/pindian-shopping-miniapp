ALTER TABLE ai_support_turns
 ADD COLUMN intent varchar(32) NOT NULL DEFAULT 'general' CHECK(intent IN ('general','product_recommendation','product_introduction')),
 ADD COLUMN recommendations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(recommendations)='array' AND jsonb_array_length(recommendations)<=3),
 ADD CONSTRAINT ai_guidance_completed_only CHECK(status='completed' OR (intent='general' AND recommendations='[]'::jsonb));
