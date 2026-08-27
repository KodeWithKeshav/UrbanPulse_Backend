require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://edragfuoklcgdgtospuq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkcmFnZnVva2xjZ2RndG9zcHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NDE3MjMsImV4cCI6MjA3MjExNzcyM30.A58Ms03zTZC6J5OuhQbkkZQy-5uTxgu4vlLilrjPEwo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function deleteComplaints() {
    console.log("Locating complaints in Coimbatore...");
    
    // First, select them to see exactly how many we are deleting
    const { data: complaints, error: selectError } = await supabase
        .from('complaints')
        .select('id')
        .gte('location_latitude', 10.9)
        .lte('location_latitude', 11.2)
        .gte('location_longitude', 76.8)
        .lte('location_longitude', 77.2);

    if (selectError) {
        console.error("Error fetching complaints:", selectError);
        return;
    }

    if (!complaints || complaints.length === 0) {
        console.log("No complaints found in Coimbatore region. Nothing to delete.");
        return;
    }

    const complaintIds = complaints.map(c => c.id);
    console.log(`Ready to delete ${complaintIds.length} complaints.`);

    // Perform deletion using the retrieved IDs
    const { data: deleted, error: deleteError } = await supabase
        .from('complaints')
        .delete()
        .in('id', complaintIds);

    if (deleteError) {
        console.error("Error during deletion:", deleteError.message);
        return;
    }

    console.log(`Successfully deleted ${complaintIds.length} complaints.`);

    // Verify deletion
    const { count, error: countError } = await supabase
        .from('complaints')
        .select('*', { count: 'exact', head: true })
        .gte('location_latitude', 10.9)
        .lte('location_latitude', 11.2)
        .gte('location_longitude', 76.8)
        .lte('location_longitude', 77.2);

    if (countError) {
        console.error("Error verifying deletion:", countError);
    } else {
        console.log(`Verification: ${count} complaints remaining in Coimbatore area.`);
    }
}

deleteComplaints();
