// Scroll reveal animation

(function () {

var sections = document.querySelectorAll("section")

if (!sections.length) return

var observer = new IntersectionObserver(
function (entries) {

entries.forEach(function (entry) {

if (entry.isIntersecting) {
entry.target.classList.add("section-visible")
}

})

},
{
threshold:0.1,
rootMargin:"0px 0px -50px 0px"
}
)

sections.forEach(function (section) {
observer.observe(section)
})

})()



// Expandable research cards

document.querySelectorAll(".research-card").forEach(card => {

card.addEventListener("click", () => {

card.classList.toggle("expanded")

})

})
