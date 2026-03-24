-- Create complaint_feedback table for storing user feedback
CREATE TABLE IF NOT EXISTS complaint_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID REFERENCES complaints(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Can be null for guest feedback
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback_text TEXT,
    improvement_suggestions TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_complaint_feedback_complaint_id ON complaint_feedback(complaint_id);
CREATE INDEX IF NOT EXISTS idx_complaint_feedback_user_id ON complaint_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_complaint_feedback_rating ON complaint_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_complaint_feedback_created_at ON complaint_feedback(created_at);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
DROP TRIGGER IF EXISTS trigger_update_feedback_updated_at ON complaint_feedback;
CREATE TRIGGER trigger_update_feedback_updated_at
    BEFORE UPDATE ON complaint_feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_feedback_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE complaint_feedback ENABLE ROW LEVEL SECURITY;

-- Create policies for RLS
CREATE POLICY "Users can insert their own feedback" ON complaint_feedback
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can view their own feedback" ON complaint_feedback
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Admins can view all feedback" ON complaint_feedback
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.user_type = 'admin'
        )
    );

-- Grant necessary permissions
GRANT SELECT, INSERT ON complaint_feedback TO authenticated;
GRANT SELECT, INSERT ON complaint_feedback TO anon;
