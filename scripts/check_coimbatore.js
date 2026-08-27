require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://edragfuoklcgdgtospuq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkcmFnZnVva2xjZ2RndG9zcHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NDE3MjMsImV4cCI6MjA3MjExNzcyM30.A58Ms03zTZC6J5OuhQbkkZQy-5uTxgu4vlLilrjPEwo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
    console.log("Checking Supabase tables...");
    
    const { data: complaints, error } = await supabase
        .from('complaints')
        .select('*')
        .gte('location_latitude', 10.9)
        .lte('location_latitude', 11.2)
        .gte('location_longitude', 76.8)
        .lte('location_longitude', 77.2);

    if (error) {
        console.error("Error fetching complaints:", error);
        return;
    }

    console.log(`Found ${complaints.length} complaints in Coimbatore area.`);
    if (complaints.length > 0) {
        console.log("Sample complaint IDs:", complaints.slice(0, 3).map(c => c.id));
    } else {
        return;
    }

    const knownRelatedTables = ['complaint_stages', 'complaint_images', 'notifications', 'upvotes', 'comments'];
    const complaintIds = complaints.map(c => c.id);
    
    for (const table of knownRelatedTables) {
        try {
            const { count, error: tableError } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .in('complaint_id', complaintIds);
            
            if (tableError) {
                console.log(`Table ${table} might not have complaint_id:`, tableError.message);
            } else {
                console.log(`Found ${count} records in ${table} referencing these complaints.`);
            }
        } catch (err) {
            console.log(`Error checking table ${table}:`, err.message);
        }
    }
}

checkDatabase();
