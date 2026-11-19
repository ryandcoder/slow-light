// Slow Light: site settings.
// Leave supabaseUrl empty to see the site in DEMO mode (sample frames, likes and
// comments saved only in your own browser). Fill these in to go live.
//
// None of these values are secret: the anon/publishable key is meant to be public
// (the database rules only let visitors read). Never put the service/secret key here.
window.SLOW_LIGHT = {
  supabaseUrl: "https://ervatalmkuoegaylwgtl.supabase.co",        // e.g. https://abcdxyz.supabase.co
  supabaseAnonKey: "sb_publishable_5cgWZYrLIMtLK3RtKS8Fhw_ApoJnEKX",    // Supabase > Project Settings > API > anon / publishable key
  apiUrl: "https://slow-light-api.onrender.com",             // e.g. https://slow-light-api.onrender.com  (your Render service)
  bucket: "photos",       // storage bucket name (leave as is)

  ownerName: "Kim Ryan Nabo",          // shown in the footer, e.g. "Kim Ryan Nabo"
  contactEmail: "nabokimryan@gmail.com"        // shown in the footer, e.g. "you@example.com"
};
