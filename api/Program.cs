using Microsoft.AspNetCore.SpaServices.ReactDevelopmentServer;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddSpaStaticFiles(configuration =>
{
    configuration.RootPath = "../web/build";
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
var reactBuildPath = Path.Combine(builder.Environment.ContentRootPath, "../web/public");
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(reactBuildPath),
    OnPrepareResponse = ctx =>
    {
        if (ctx.File.Name.Equals("manifest.json", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
        }
    }
});

app.UseSpaStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        if (ctx.File.Name.Equals("manifest.json", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
        }
    }
});

app.UseRouting();

app.UseAuthorization();

app.UseEndpoints(endpoints =>
{
    endpoints.MapControllers();
});

app.UseSpa(spa =>
{
    spa.Options.SourcePath = "../web";

    if (app.Environment.IsDevelopment())
    {
        spa.UseReactDevelopmentServer(npmScript: "start");
    }
});

app.Run();