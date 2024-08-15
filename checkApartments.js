const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { Resend } = require("resend");

require("dotenv").config();

const resend = new Resend(process.env.RESEND_API_KEY);

const url = "https://vancouver.craigslist.org/search/burnaby-bc/apa?lat=49.2652&lon=-123.0138&search_distance=0.22#search=1~map~0~0~49.2684~-123.0254~49.2622~-123.0024";
const interval = 4 * 60 * 60 * 1000; // 4 hours

async function fetchListings() {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const listings = [];
    const baseURL = 'https://vancouver.craigslist.org';

    const promises = $('li.cl-static-search-result').map(async (index, element) => {
      const title = $(element).find('a .title').text().trim();
      let link = $(element).find('a').attr('href');
      
      // Correctly handle relative URLs
      if (link.startsWith('/')) {
        link = baseURL + link;
      }

      const priceText = $(element).find('a .price').text().trim();
      const price = parseInt(priceText.replace(/[^0-9]/g, ''), 10);

      if (title && link && price <= 3000) {
        const detailPage = await axios.get(link);
        const detail$ = cheerio.load(detailPage.data);
        const postingBody = detail$('#postingbody').text().trim().toLowerCase();
        
        // Extract posted and updated dates
        const postedDateText = detail$('time[datetime]').first().attr('datetime');
        const updatedDateText = detail$('time[datetime]').last().attr('datetime');
        
        const postedDate = new Date(postedDateText);
        const updatedDate = new Date(updatedDateText);

        // Use the newest date (either posted or updated) for sorting
        const date = updatedDate > postedDate ? updatedDate : postedDate;

        const listing = { title, link, price, postingBody, date };

        if (title.toLowerCase().includes('gilmore place') || 
            title.toLowerCase().includes('2186 gilmore') ||
            postingBody.includes('gilmore place') ||
            postingBody.includes('2186 gilmore')) {
          listing.highlighted = true;
        }

        listings.push(listing);
      }
    }).get();

    await Promise.all(promises);
    console.log(listings);

    return listings;
  } catch (error) {
    console.error('Error fetching listings:', error);
    return [];
  }
}

async function checkForNewListings() {
  const listings = await fetchListings();
  let previousListings = [];

  if (fs.existsSync('listings.json')) {
    previousListings = JSON.parse(fs.readFileSync('listings.json', 'utf-8'));
  }

  const newListings = listings.filter(
    (listing) => !previousListings.some((prev) => prev.link === listing.link)
  );

  fs.writeFileSync('listings.json', JSON.stringify(listings));

  if (newListings.length === 0) {
    sendEmail('No new listings', '<p>There are no new apartment listings available.</p>');
  } else {
    const gilmoreListings = newListings.filter(listing =>
      listing.title.toLowerCase().includes('gilmore place') || 
      listing.title.toLowerCase().includes('2186 gilmore') || 
      listing.postingBody.toLowerCase().includes('gilmore place') || 
      listing.postingBody.toLowerCase().includes('2186 gilmore')
    );

    gilmoreListings.sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first
    newListings.sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first

    let message = '<h2>Listings Mentioning "Gilmore Place" or "2186 Gilmore"</h2>';
    if (gilmoreListings.length > 0) {
      message += '<ol>';
      message += gilmoreListings
        .map(listing => `<li>${listing.title} ($${listing.price}): <a href="${listing.link}">${listing.link}</a></li>`)
        .join('');
      message += '</ol>';
    } else {
      message += '<p>No listings mentioning "Gilmore Place" or "2186 Gilmore" found.</p>';
    }

    message += '<h2>All New Listings</h2>';
    message += '<ol>';
    message += newListings
      .map(listing => `<li>${listing.title} ($${listing.price}): <a href="${listing.link}">${listing.link}</a></li>`)
      .join('');
    message += '</ol>';

    sendEmail('New apartment listings available', message);
  }
}

async function sendEmail(subject, html) {
  try {
    const { data, error } = await resend.emails.send({
      from: "Apartment Notifier <listings@diegolara.dev>",
      to: [process.env.EMAIL_TO],
      subject,
      html,
    });

    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Email sent:", data);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

checkForNewListings();
